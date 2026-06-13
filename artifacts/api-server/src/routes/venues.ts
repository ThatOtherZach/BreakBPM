import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, venuesTable } from "@workspace/db";
import {
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
} from "@workspace/api-zod";
import { getOrCreateUser } from "../lib/auth";
import { isAdminEmail } from "../lib/config";
import { newId } from "../lib/ids";
import { fetchOsmVenuesForBBox } from "../lib/osmVenues";

const router: IRouter = Router();

type VenueRow = typeof venuesTable.$inferSelect;

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
 * GET /venues — the admin-curated set of ACTIVE verified pool-hall venues for
 * the map and the nearest-hall compass. Venue coordinates are public business
 * locations (unlike meetup posts, which expose a person), so every signed-in
 * caller gets them in full. Signed-out callers get an empty list — venue
 * features are gated to signed-in users in the UI.
 */
router.get("/venues", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.json(ListVenuesResponse.parse({ venues: [] }));
    return;
  }

  const rows = await db
    .select()
    .from(venuesTable)
    .where(eq(venuesTable.active, true))
    .orderBy(desc(venuesTable.createdAt));

  res.json(ListVenuesResponse.parse({ venues: rows.map(toVenueResponse) }));
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

  const [row] = await db
    .insert(venuesTable)
    .values({
      id: newId(),
      name: b.name,
      latitude: b.latitude,
      longitude: b.longitude,
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

  const [row] = await db
    .update(venuesTable)
    .set({
      name: b.name,
      latitude: b.latitude,
      longitude: b.longitude,
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
