import { and, desc, gte } from "drizzle-orm";
import { db, gamesTable } from "@workspace/db";
import { LUCKY_BREAK_WINDOW_DAYS, type EntropyShot } from "./luckyBreak";

/**
 * Reads the entropy source for a Lucky Break roll: every shot logged across
 * the app in the last `LUCKY_BREAK_WINDOW_DAYS`. This is deliberately GLOBAL,
 * not per-user — it is a seed, not a stat, so the wider and more chaotic the
 * pool the better. The pure roll engine (`luckyBreak.ts`) turns these rows
 * into the actual draw; this module only gathers them.
 *
 * Bounded by `MAX_GAMES` so a busy app can't make a redeem call unbounded.
 */

/** Defensive upper bound on games scanned for entropy in one roll. */
const MAX_GAMES = 2000;

interface ShotEntry {
  type?: string;
  ball?: number;
  timestamp?: number;
}

export async function gatherShotEntropy(
  now: Date = new Date(),
): Promise<EntropyShot[]> {
  const cutoff = new Date(now.getTime() - LUCKY_BREAK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const cutoffMs = cutoff.getTime();
  const rows = await db
    .select({ id: gamesTable.id, gameState: gamesTable.gameState })
    .from(gamesTable)
    .where(and(gte(gamesTable.lastActivityAt, cutoff)))
    .orderBy(desc(gamesTable.lastActivityAt))
    .limit(MAX_GAMES);

  const shots: EntropyShot[] = [];
  for (const r of rows) {
    const gs = (r.gameState ?? {}) as Record<string, unknown>;
    const log = Array.isArray(gs["shotLog"]) ? (gs["shotLog"] as ShotEntry[]) : [];
    for (const e of log) {
      if (typeof e.timestamp !== "number") continue;
      // A game can be active within the window while holding older shots from a
      // long-running session. Filter per-shot so the seed reflects exactly the
      // disclosed "last N days" window, not just games touched within it.
      if (e.timestamp < cutoffMs) continue;
      shots.push({
        gameId: r.id,
        ts: e.timestamp,
        ball: typeof e.ball === "number" ? e.ball : null,
        type: typeof e.type === "string" ? e.type : "",
      });
    }
  }
  return shots;
}
