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
  // Pull the candidates first so we can derive a per-game winner (the
  // opponent of whoever was on the table when activity stopped) instead
  // of leaving forfeited rows with a null winner.
  const candidates = await db
    .select()
    .from(gamesTable)
    .where(
      and(
        eq(gamesTable.userId, userId),
        isNull(gamesTable.endedAt),
        lt(gamesTable.lastActivityAt, cutoff),
        ne(gamesTable.gameType, "practice"),
      ),
    );
  if (candidates.length === 0) return 0;

  for (const row of candidates) {
    let winner: string | null = null;
    let forfeitingPlayer: string | null = null;
    const gs = row.gameState as {
      players?: { name: string }[];
      currentPlayerIndex?: number;
    } | null;
    const players = gs?.players;
    const idx = gs?.currentPlayerIndex;
    if (Array.isArray(players) && players.length > 1 && typeof idx === "number") {
      forfeitingPlayer = players[idx]?.name ?? null;
      winner = players[(idx + 1) % players.length]?.name ?? null;
    }
    await db
      .update(gamesTable)
      .set({
        endedAt: now,
        outcome: "forfeit",
        winner,
        // Fold a forfeit-reason marker into gameState so the history view
        // and any downstream consumers can surface why the game ended.
        gameState: {
          ...((row.gameState as Record<string, unknown> | null) ?? {}),
          forfeitReason: "inactivity_60min",
          forfeitedPlayer: forfeitingPlayer,
        },
      })
      .where(eq(gamesTable.id, row.id));
  }
  return candidates.length;
}
