import { Router, type IRouter } from "express";
import { and, asc, count, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db, findPlayerPostsTable, usersTable } from "@workspace/db";
import {
  ListFindPlayerPostsQueryParams,
  ListFindPlayerPostsResponse,
  CreateFindPlayerPostBody,
  CreateFindPlayerPostResponse,
  CancelFindPlayerPostBody,
  CancelFindPlayerPostResponse,
} from "@workspace/api-zod";
import { getOrCreateUser } from "../lib/auth";
import { computeEntitlement } from "../lib/entitlement";
import { newId } from "../lib/ids";

const router: IRouter = Router();

/** Posts per page in the list view. */
const PAGE_SIZE = 10;
/** Hard cap on a user's simultaneously-active (non-cancelled) posts. */
const MAX_ACTIVE_POSTS = 5;

type PostRow = typeof findPlayerPostsTable.$inferSelect;

/** Thrown inside the create transaction to abort with a specific client reason. */
class CreateRuleError extends Error {
  constructor(public reason: "limit_reached" | "duplicate_date") {
    super(reason);
  }
}

/** Detect a Postgres unique-constraint violation (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code
    ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/**
 * Reverse-geocode a WGS84 coordinate via Nominatim, returning a short
 * human label like "Los Angeles, United States". Returns null on failure
 * (network error, rate-limit, unrecognised place) — never throws.
 */
async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "BreakBPM/1.0 (find-players feature)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as {
      address?: { city?: string; town?: string; village?: string; county?: string; country?: string };
    };
    const addr = data.address;
    if (!addr) return null;
    const locality = addr.city ?? addr.town ?? addr.village ?? addr.county ?? null;
    const country = addr.country ?? null;
    if (!locality && !country) return null;
    return [locality, country].filter(Boolean).join(", ");
  } catch {
    return null;
  }
}

/**
 * Shape a DB row into the API contract. Cancelled posts hide their place and
 * time — only the "Cancelled" badge and (for the owner) the card remain until
 * the original time passes and the row is purged.
 *
 * `canSeeExact` gates PRECISE coordinates: a meetup post publishes the host's
 * real-world location, so exact lat/lng is disclosed only to paid (tier ===
 * 'pass') callers and to the post's own owner. Free/no-pass callers get null
 * lat/lng for posts they don't own and rely on the coarse `locationLabel`
 * (city-level reverse-geocode) instead. Cancelled posts hide coordinates from
 * everyone, owner included.
 */
function toPostResponse(
  row: PostRow,
  screenName: string,
  callerUserId: string,
  canSeeExact: boolean,
) {
  const cancelled = row.cancelledAt != null;
  const isOwn = row.userId === callerUserId;
  const showExact = !cancelled && (isOwn || canSeeExact);
  return {
    id: row.id,
    // Cancelled posts hide the host's identity (along with place/time below) —
    // the card just reads "Open Table" until the original time passes.
    displayName: cancelled ? "Open Table" : `${screenName}, Table #${row.tableNumber}`,
    userName: cancelled ? "Open Table" : screenName,
    tableNumber: row.tableNumber,
    latitude: showExact ? row.latitude : null,
    longitude: showExact ? row.longitude : null,
    locationLabel: cancelled ? null : (row.locationLabel ?? null),
    scheduledAt: cancelled ? null : row.scheduledAt,
    cancelled,
    isOwn,
  };
}

/** Start of the UTC calendar day containing `d` (00:00:00.000Z). */
function startOfUtcDay(d: Date): Date {
  const s = new Date(d);
  s.setUTCHours(0, 0, 0, 0);
  return s;
}

/**
 * The "still active" lower bound for posts, with a full UTC day of timezone
 * grace. The client gatekeeps "not before the poster's LOCAL today", but a
 * given local date can map anywhere from the previous to the next UTC day, so
 * the server treats a post as active from the start of the PREVIOUS UTC day.
 * This guarantees a legitimate local-today post is never rejected/hidden/
 * purged just because UTC has rolled over.
 */
const ACTIVE_GRACE_MS = 24 * 60 * 60 * 1000;
function activePostsSince(now: Date): Date {
  return new Date(startOfUtcDay(now).getTime() - ACTIVE_GRACE_MS);
}

/**
 * Durable housekeeping: drop posts older than the active-window boundary
 * (`activePostsSince` — the start of the previous UTC day, a full day of
 * timezone grace). Read-time filtering (every list query uses the same
 * boundary) is the correctness guarantee; this sweep-on-write/read keeps the
 * table from growing unbounded without relying on an in-process timer that
 * would not survive a restart.
 */
async function purgeExpiredPosts(now: Date): Promise<void> {
  await db.delete(findPlayerPostsTable).where(lt(findPlayerPostsTable.scheduledAt, activePostsSince(now)));
}

/** Count a user's active (non-cancelled, within the active window) posts. */
async function countActivePosts(userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(findPlayerPostsTable)
    .where(
      and(
        eq(findPlayerPostsTable.userId, userId),
        isNull(findPlayerPostsTable.cancelledAt),
        gte(findPlayerPostsTable.scheduledAt, activePostsSince(now)),
      ),
    );
  return row?.n ?? 0;
}

/**
 * GET /find-players/posts — paginated, soonest-first list of active posts.
 * Signed-out callers get an empty list (the page shows a sign-in prompt).
 */
router.get("/find-players/posts", async (req, res): Promise<void> => {
  const parsed = ListFindPlayerPostsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const page = parsed.data.page ?? 1;
  const all = parsed.data.all ?? false;
  const now = new Date();

  const user = await getOrCreateUser(req);
  if (!user) {
    res.json(
      ListFindPlayerPostsResponse.parse({
        signedIn: false,
        canCreate: false,
        preciseLocationsVisible: false,
        activePostCount: 0,
        maxActivePosts: MAX_ACTIVE_POSTS,
        posts: [],
        page: 1,
        totalPages: 0,
        total: 0,
      }),
    );
    return;
  }

  await purgeExpiredPosts(now);

  const entitlement = await computeEntitlement(user);
  const canCreate = entitlement.tier === "pass";
  // Paid callers see exact coordinates for every post; free/no-pass callers see
  // exact coords only for their OWN posts (handled per-row in toPostResponse).
  const canSeeExact = entitlement.tier === "pass";

  // A post is listable from the active-window boundary (previous UTC day, for
  // timezone grace) onward — including cancelled-but-not-yet-expired posts
  // (which render a "Cancelled" badge).
  const activeFilter = gte(findPlayerPostsTable.scheduledAt, activePostsSince(now));

  const [{ n: total } = { n: 0 }] = await db
    .select({ n: count() })
    .from(findPlayerPostsTable)
    .where(activeFilter);

  // `all=true` (map view) returns every active post in one page; otherwise
  // the list is paginated 10/page.
  const totalPages = all ? (total > 0 ? 1 : 0) : Math.ceil(total / PAGE_SIZE);
  const baseQuery = db
    .select({ post: findPlayerPostsTable, screenName: usersTable.screenName })
    .from(findPlayerPostsTable)
    .innerJoin(usersTable, eq(usersTable.id, findPlayerPostsTable.userId))
    .where(activeFilter)
    .orderBy(asc(findPlayerPostsTable.scheduledAt))
    .$dynamic();
  const rows = all
    ? await baseQuery
    : await baseQuery.limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE);

  const activePostCount = await countActivePosts(user.id, now);

  res.json(
    ListFindPlayerPostsResponse.parse({
      signedIn: true,
      canCreate,
      preciseLocationsVisible: canSeeExact,
      activePostCount,
      maxActivePosts: MAX_ACTIVE_POSTS,
      posts: rows.map((r) => toPostResponse(r.post, r.screenName, user.id, canSeeExact)),
      page: all ? 1 : page,
      totalPages,
      total,
    }),
  );
});

/**
 * POST /find-players/posts — create a post. Paid tier only. Enforces the
 * per-UTC-date, max-5, and 1-year-out rules.
 */
router.post("/find-players/posts", async (req, res): Promise<void> => {
  const parsed = CreateFindPlayerPostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { latitude, longitude, tableNumber } = parsed.data;
  const scheduledAt = new Date(parsed.data.scheduledAt);
  const now = new Date();

  const user = await getOrCreateUser(req);
  if (!user) {
    res.json(CreateFindPlayerPostResponse.parse({ success: false, reason: "not_signed_in" }));
    return;
  }

  const entitlement = await computeEntitlement(user);
  if (entitlement.tier !== "pass") {
    res.json(CreateFindPlayerPostResponse.parse({ success: false, reason: "not_paid" }));
    return;
  }

  // Backstop only: the client gatekeeps the poster's LOCAL "today". Reject
  // anything before the timezone-grace boundary (start of the previous UTC
  // day) so a legitimate local-today post is never falsely rejected.
  if (scheduledAt.getTime() < activePostsSince(now).getTime()) {
    res.json(CreateFindPlayerPostResponse.parse({ success: false, reason: "in_past" }));
    return;
  }
  const oneYearOut = new Date(now);
  oneYearOut.setUTCFullYear(oneYearOut.getUTCFullYear() + 1);
  if (scheduledAt.getTime() > oneYearOut.getTime()) {
    res.json(CreateFindPlayerPostResponse.parse({ success: false, reason: "too_far" }));
    return;
  }

  await purgeExpiredPosts(now);

  // Geocode outside the transaction — Nominatim is a network call and we don't
  // want to hold a DB lock while it's in flight. Failure is non-fatal.
  const locationLabel = await reverseGeocode(latitude, longitude);

  const scheduledDateUtc = scheduledAt.toISOString().slice(0, 10);

  // Enforce the max-5 and per-UTC-date rules atomically. We serialize all of a
  // user's create attempts by taking a row lock on their `users` row first, so
  // concurrent requests cannot each pass the count/dupe checks and overshoot
  // the limit. The partial unique index (user_id, scheduled_date_utc WHERE
  // cancelled_at IS NULL) remains the last-resort durable guarantee.
  try {
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM ${usersTable} WHERE ${eq(usersTable.id, user.id)} FOR UPDATE`);

      const [{ n: activeCount } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(findPlayerPostsTable)
        .where(
          and(
            eq(findPlayerPostsTable.userId, user.id),
            isNull(findPlayerPostsTable.cancelledAt),
            gte(findPlayerPostsTable.scheduledAt, activePostsSince(now)),
          ),
        );
      if (activeCount >= MAX_ACTIVE_POSTS) throw new CreateRuleError("limit_reached");

      const [dupe] = await tx
        .select({ id: findPlayerPostsTable.id })
        .from(findPlayerPostsTable)
        .where(
          and(
            eq(findPlayerPostsTable.userId, user.id),
            eq(findPlayerPostsTable.scheduledDateUtc, scheduledDateUtc),
            isNull(findPlayerPostsTable.cancelledAt),
          ),
        )
        .limit(1);
      if (dupe) throw new CreateRuleError("duplicate_date");

      const [row] = await tx
        .insert(findPlayerPostsTable)
        .values({
          id: newId(),
          userId: user.id,
          latitude,
          longitude,
          locationLabel,
          tableNumber,
          scheduledAt,
          scheduledDateUtc,
        })
        .returning();
      return row;
    });

    req.log.info({ userId: user.id, postId: created.id }, "Find Players post created");
    res.json(
      CreateFindPlayerPostResponse.parse({
        success: true,
        post: toPostResponse(created, user.screenName, user.id, true),
      }),
    );
  } catch (err) {
    if (err instanceof CreateRuleError) {
      res.json(CreateFindPlayerPostResponse.parse({ success: false, reason: err.reason }));
      return;
    }
    // Unique-index violation → an active post already exists for this date.
    if (isUniqueViolation(err)) {
      req.log.warn({ userId: user.id }, "Find Players post insert conflict");
      res.json(CreateFindPlayerPostResponse.parse({ success: false, reason: "duplicate_date" }));
      return;
    }
    throw err; // Unexpected DB error → 500 via the error handler.
  }
});

/**
 * POST /find-players/posts/cancel — cancel one of the caller's own posts.
 * Strips the place/time exposure (handled in toPostResponse) but leaves the
 * card visible until the original time passes.
 */
router.post("/find-players/posts/cancel", async (req, res): Promise<void> => {
  const parsed = CancelFindPlayerPostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.json(CancelFindPlayerPostResponse.parse({ success: false, reason: "not_signed_in" }));
    return;
  }

  const [updated] = await db
    .update(findPlayerPostsTable)
    .set({ cancelledAt: new Date() })
    .where(
      and(
        eq(findPlayerPostsTable.id, parsed.data.id),
        eq(findPlayerPostsTable.userId, user.id),
        isNull(findPlayerPostsTable.cancelledAt),
      ),
    )
    .returning();

  if (!updated) {
    res.json(CancelFindPlayerPostResponse.parse({ success: false, reason: "not_found" }));
    return;
  }

  req.log.info({ userId: user.id, postId: updated.id }, "Find Players post cancelled");
  res.json(
    CancelFindPlayerPostResponse.parse({
      success: true,
      post: toPostResponse(updated, user.screenName, user.id, true),
    }),
  );
});

export default router;
