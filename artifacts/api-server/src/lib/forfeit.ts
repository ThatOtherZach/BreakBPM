import { and, eq, isNull, lt } from "drizzle-orm";
import { db, gamesTable } from "@workspace/db";

/**
 * Server-side inactivity threshold. Mirrored on the client (the in-memory
 * countdown is for UX only — this server constant is authoritative).
 */
export const INACTIVITY_FORFEIT_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Sweep any in-progress games for a user whose `lastActivityAt` is older
 * than the inactivity threshold and finalize them as forfeits. Called
 * lazily on /games/start, /games/heartbeat, and /games/history so we don't
 * need a background job to keep state honest.
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
      ),
    )
    .returning({ id: gamesTable.id });
  return stale.length;
}
