import { Router, type IRouter } from "express";
import { count, desc, eq } from "drizzle-orm";
import { db, venuesTable } from "@workspace/db";
import {
  ListVenuesQueryParams,
  ListVenuesResponse,
  ListOsmVenuesQueryParams,
  ListOsmVenuesResponse,
  ListAdminVenuesResponse,
  CreateVenueBody,
  CreateVenueResponse,
  UpdateVenueParams,
  UpdateVenueBody,
  UpdateVenueResponse,
  DeleteVenueParams,
  DeleteVenueResponse,
  RepairVenueCoordinatesResponse,
} from "@workspace/api-zod";
import { getOrCreateUser } from "../lib/auth";
import { isAdminEmail } from "../lib/config";
import { newId } from "../lib/ids";
import { fetchOsmVenuesForBBox } from "../lib/osmVenues";
import { geocodeAddress, haversineMeters } from "../lib/geocode";

const router: IRouter = Router();

type VenueRow = typeof venuesTable.$inferSelect;

// Nominatim asks for ~1 request/sec; space the bulk repair calls accordingly.
// Tests mock the geocoder, so skip the wait there to keep them fast.
const REPAIR_THROTTLE_MS = process.env.NODE_ENV === "test" ? 0 : 1100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Coordinates for a venue write. The address is authoritative: when one is
 * provided we geocode it and use the result, so a hand-typed or roughly-clicked
 * lat/lng can never leave the pin drifting off the real hall. We fall back to
 * the submitted coordinates only when there is no address or the address can't
 * be geocoded — so manual placement still works and a geocoder outage never
 * blocks a save.
 */
async function resolveVenueCoords(b: {
  address?: string | null;
  locality?: string | null;
  latitude: number;
  longitude: number;
}): Promise<{ lat: number; lng: number }> {
  const addr = (b.address ?? "").trim();
  if (addr) {
    const geo = await geocodeAddress(addr, b.locality);
    if (geo) return geo;
  }
  return { lat: b.latitude, lng: b.longitude };
}

/** Shape a DB row into the public Venue contract (drops audit-only columns). */
function toVenueResponse(row: VenueRow) {
  return {
    id: row.id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    locality: row.locality,
    address: row.address,
    tableCount: row.tableCount,
    contact: row.contact,
    paymentType: row.paymentType,
    active: row.active,
    paidThroughAt: row.paidThroughAt,
  };
}

/**
 * GET /venues — a page of the admin-curated set of ACTIVE verified pool-hall
 * venues for the nearest-hall compass list, newest-first. Pagination is
 * server-side (page/limit) so the payload stays small as the directory grows;
 * the response carries the total count and total page count so the client can
 * drive Prev/Next. Venue coordinates are public business locations (unlike
 * meetup posts, which expose a person), so every signed-in caller gets them in
 * full. Signed-out callers get an empty page — venue features are gated to
 * signed-in users in the UI.
 */
router.get("/venues", async (req, res): Promise<void> => {
  const parsed = ListVenuesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, limit, all } = parsed.data;

  const user = await getOrCreateUser(req);
  if (!user) {
    res.json(
      ListVenuesResponse.parse({ venues: [], page: 1, totalPages: 0, total: 0 }),
    );
    return;
  }

  const activeFilter = eq(venuesTable.active, true);

  const [{ n: total } = { n: 0 }] = await db
    .select({ n: count() })
    .from(venuesTable)
    .where(activeFilter);

  // `all=true` (the nearest-hall compass) returns every active venue in one
  // page; otherwise the list is paginated `limit`/page, newest-first.
  const totalPages = all ? (total > 0 ? 1 : 0) : Math.ceil(total / limit);
  const baseQuery = db
    .select()
    .from(venuesTable)
    .where(activeFilter)
    .orderBy(desc(venuesTable.createdAt))
    .$dynamic();
  const rows = all
    ? await baseQuery
    : await baseQuery.limit(limit).offset((page - 1) * limit);

  res.json(
    ListVenuesResponse.parse({
      venues: rows.map(toVenueResponse),
      page: all ? 1 : page,
      totalPages,
      total,
    }),
  );
});

/**
 * GET /venues/osm — live OpenStreetMap billiards venues for a viewport, proxied
 * + cached server-side (see lib/osmVenues.ts for why the browser can't do this
 * itself). Signed-in only: we don't run outbound Overpass queries for anonymous
 * callers, so this never becomes an open relay. Always 200 for signed-in callers
 * (the body's `status` carries ok / too_broad / error); 401 for signed-out.
 */
router.get("/venues/osm", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to load venues" });
    return;
  }

  const parsed = ListOsmVenuesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { south, west, north, east } = parsed.data;

  const result = await fetchOsmVenuesForBBox({ south, west, north, east });
  res.json(ListOsmVenuesResponse.parse(result));
});

/**
 * GET /admin/venues — every verified venue (active AND inactive), newest-first,
 * for the admin management panel. Admin-only (403 for everyone else).
 */
router.get("/admin/venues", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage venues" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const rows = await db
    .select()
    .from(venuesTable)
    .orderBy(desc(venuesTable.createdAt));

  res.json(ListAdminVenuesResponse.parse({ venues: rows.map(toVenueResponse) }));
});

/**
 * POST /admin/venues — add a verified venue. Admin-only (403 for everyone
 * else). Payment is handled offline; `active` controls visibility and
 * `paidThroughAt` is an informational note (no enforcement).
 */
router.post("/admin/venues", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage venues" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const parsed = CreateVenueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;
  const coords = await resolveVenueCoords(b);

  const [row] = await db
    .insert(venuesTable)
    .values({
      id: newId(),
      name: b.name,
      latitude: coords.lat,
      longitude: coords.lng,
      locality: b.locality ?? null,
      address: b.address ?? null,
      tableCount: b.tableCount ?? null,
      contact: b.contact ?? null,
      paymentType: b.paymentType ?? null,
      active: b.active ?? true,
      paidThroughAt: b.paidThroughAt ?? null,
      createdByUserId: user.id,
    })
    .returning();

  req.log.info({ userId: user.id, venueId: row.id }, "Venue created");
  res.json(CreateVenueResponse.parse({ success: true, venue: toVenueResponse(row) }));
});

/**
 * POST /admin/venues/repair-coordinates — re-derive every venue's coordinates
 * from its saved address (the address is authoritative) and update any pin that
 * has drifted. Admin-only (403 for everyone else). Venues with no address, or
 * whose address can't be geocoded, KEEP their existing coordinates and are
 * reported as `failed` so the admin can fix those by hand — we never overwrite a
 * pin with a wrong/guessed point. Geocoder calls are throttled to respect
 * Nominatim's ~1 req/sec policy, so a large set can take a little while.
 */
router.post(
  "/admin/venues/repair-coordinates",
  async (req, res): Promise<void> => {
    const user = await getOrCreateUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to manage venues" });
      return;
    }
    if (!isAdminEmail(user.email)) {
      res.status(403).json({ error: "Admins only" });
      return;
    }

    const rows = await db
      .select()
      .from(venuesTable)
      .orderBy(desc(venuesTable.createdAt));

    const items: Array<{
      id: string;
      name: string;
      status: "updated" | "unchanged" | "failed";
      distanceMeters: number | null;
    }> = [];
    let updated = 0;
    let unchanged = 0;
    let failed = 0;
    let madeNetworkCall = false;

    for (const row of rows) {
      const addr = (row.address ?? "").trim();
      if (!addr) {
        failed++;
        items.push({ id: row.id, name: row.name, status: "failed", distanceMeters: null });
        continue;
      }

      // Space out the real network calls (no wait before the first one).
      if (madeNetworkCall) await sleep(REPAIR_THROTTLE_MS);
      madeNetworkCall = true;

      const geo = await geocodeAddress(addr, row.locality);
      if (!geo) {
        failed++;
        items.push({ id: row.id, name: row.name, status: "failed", distanceMeters: null });
        continue;
      }

      const dist = haversineMeters(row.latitude, row.longitude, geo.lat, geo.lng);
      if (dist < 1) {
        unchanged++;
        items.push({ id: row.id, name: row.name, status: "unchanged", distanceMeters: 0 });
        continue;
      }

      await db
        .update(venuesTable)
        .set({ latitude: geo.lat, longitude: geo.lng, updatedAt: new Date() })
        .where(eq(venuesTable.id, row.id));
      updated++;
      items.push({
        id: row.id,
        name: row.name,
        status: "updated",
        distanceMeters: Math.round(dist),
      });
    }

    req.log.info(
      { userId: user.id, total: rows.length, updated, unchanged, failed },
      "Venue coordinates repaired",
    );
    res.json(
      RepairVenueCoordinatesResponse.parse({
        success: true,
        total: rows.length,
        updated,
        unchanged,
        failed,
        items,
      }),
    );
  },
);

/**
 * PATCH /admin/venues/:id — replace a venue's editable fields. Admin-only
 * (403 for everyone else). 200 + `success:false, reason:"not_found"` when the
 * id doesn't exist.
 */
router.patch("/admin/venues/:id", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage venues" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const params = UpdateVenueParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateVenueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;
  const coords = await resolveVenueCoords(b);

  const [row] = await db
    .update(venuesTable)
    .set({
      name: b.name,
      latitude: coords.lat,
      longitude: coords.lng,
      locality: b.locality ?? null,
      address: b.address ?? null,
      tableCount: b.tableCount ?? null,
      contact: b.contact ?? null,
      paymentType: b.paymentType ?? null,
      active: b.active ?? true,
      paidThroughAt: b.paidThroughAt ?? null,
      updatedAt: new Date(),
    })
    .where(eq(venuesTable.id, params.data.id))
    .returning();

  if (!row) {
    res.json(UpdateVenueResponse.parse({ success: false, reason: "not_found" }));
    return;
  }

  req.log.info({ userId: user.id, venueId: row.id }, "Venue updated");
  res.json(UpdateVenueResponse.parse({ success: true, venue: toVenueResponse(row) }));
});

/**
 * DELETE /admin/venues/:id — remove a venue permanently. Admin-only (403 for
 * everyone else). 200 + `success:false, reason:"not_found"` when the id
 * doesn't exist.
 */
router.delete("/admin/venues/:id", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage venues" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const params = DeleteVenueParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .delete(venuesTable)
    .where(eq(venuesTable.id, params.data.id))
    .returning();

  if (!row) {
    res.json(DeleteVenueResponse.parse({ success: false, reason: "not_found" }));
    return;
  }

  req.log.info({ userId: user.id, venueId: row.id }, "Venue deleted");
  res.json(DeleteVenueResponse.parse({ success: true, venue: toVenueResponse(row) }));
});

export default router;
