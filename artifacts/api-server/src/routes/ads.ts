import { Router, type IRouter } from "express";
import { asc, count, desc, eq } from "drizzle-orm";
import { db, adsTable } from "@workspace/db";
import {
  ListAdsResponse,
  ListAdminAdsQueryParams,
  ListAdminAdsResponse,
  CreateAdBody,
  CreateAdResponse,
  DeleteAdParams,
  DeleteAdResponse,
} from "@workspace/api-zod";
import { getOrCreateUser } from "../lib/auth";
import { isAdminEmail } from "../lib/config";
import { newId } from "../lib/ids";

const router: IRouter = Router();

type AdRow = typeof adsTable.$inferSelect;

/** Shape a DB row into the public Ad contract (drops audit-only columns). */
function toAdResponse(row: AdRow) {
  return { id: row.id, headline: row.headline, tagline: row.tagline };
}

/** Trim and collapse internal whitespace runs to a single space. */
function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * GET /ads — public, ordered list of every saved text ad (oldest-first) for the
 * in-game HUD rotation. Returns only id/headline/tagline. The client decides
 * who sees an ad (non-paying users only) and rotates through them client-side;
 * the server just publishes the ordered set, so this stays cheap and cacheable.
 */
router.get("/ads", async (_req, res): Promise<void> => {
  const rows = await db.select().from(adsTable).orderBy(asc(adsTable.createdAt));
  res.json(ListAdsResponse.parse({ ads: rows.map(toAdResponse) }));
});

/**
 * GET /admin/ads — paginated list of text ads (newest-first) for the admin
 * management panel. Server-side pagination mirrors the admin sales ledger
 * (limit/offset + total). Admin-only (403 for everyone else).
 */
router.get("/admin/ads", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage ads" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const parsed = ListAdminAdsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, limit } = parsed.data;

  const [{ n: total } = { n: 0 }] = await db
    .select({ n: count() })
    .from(adsTable);

  const rows = await db
    .select()
    .from(adsTable)
    .orderBy(desc(adsTable.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  res.json(
    ListAdminAdsResponse.parse({
      ads: rows.map(toAdResponse),
      page,
      limit,
      total,
    }),
  );
});

/**
 * POST /admin/ads — add a text ad (headline + tagline). Admin-only (403 for
 * everyone else). Inputs are length-bounded by the Zod schema; we additionally
 * trim + collapse whitespace and refuse an entry that's blank after cleaning.
 */
router.post("/admin/ads", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage ads" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const parsed = CreateAdBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const headline = clean(parsed.data.headline);
  const tagline = clean(parsed.data.tagline);
  if (!headline || !tagline) {
    res.json(
      CreateAdResponse.parse({
        success: false,
        reason: "Headline and tagline are required.",
      }),
    );
    return;
  }

  const [row] = await db
    .insert(adsTable)
    .values({ id: newId(), headline, tagline, createdByUserId: user.id })
    .returning();

  req.log.info({ userId: user.id, adId: row.id }, "Ad created");
  res.json(CreateAdResponse.parse({ success: true, ad: toAdResponse(row) }));
});

/**
 * DELETE /admin/ads/:id — remove a text ad permanently. Admin-only (403 for
 * everyone else). 200 + `success:false, reason:"not_found"` when the id doesn't
 * exist.
 */
router.delete("/admin/ads/:id", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage ads" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const params = DeleteAdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .delete(adsTable)
    .where(eq(adsTable.id, params.data.id))
    .returning();

  if (!row) {
    res.json(DeleteAdResponse.parse({ success: false, reason: "not_found" }));
    return;
  }

  req.log.info({ userId: user.id, adId: row.id }, "Ad deleted");
  res.json(DeleteAdResponse.parse({ success: true, ad: toAdResponse(row) }));
});

export default router;
