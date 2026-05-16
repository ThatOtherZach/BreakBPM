import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { db, gamesTable } from "@workspace/db";

/**
 * Server-side inactivity threshold. Mirrored on the client (the in-memory
 * countdown is for UX only — this server constant is authoritative).
 */
export const INACTIVITY_FORFEIT_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Sweep any in-progress games whose `lastActivityAt` is older than the
 * inactivity threshold and finalize them as forfeits.
 *
 * Practice mode is exempt — those games have no opponent / win condition,
 * so timing-out a solo drill makes no sense.
 *
 * `lastActivityAt` is bumped only by logged game actions (POST
 * /games/activity) — NOT by liveness pings — so a user can't dodge a
 * forfeit just by leaving the tab open.
 *
 * Invoked lazily on /games/start, /games/activity, and /games/history;
 * no background job required.
 */
export async function sweepStaleGames(userId: string, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - INACTIVITY_FORFEIT_MS);
  const stale = await db
    .update(gamesTable)
    .set({ endedAt: now, outcome: "forfeit" })
    .where(
      and(
        eq(gamesTable.userId, userId),
        isNull(gamesTable.endedAt),
        lt(gamesTable.lastActivityAt, cutoff),
        ne(gamesTable.gameType, "practice"),
      ),
    )
    .returning({ id: gamesTable.id });
  return stale.length;
}
