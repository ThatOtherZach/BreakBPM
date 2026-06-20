import { and, eq, isNull, lt, ne, or } from "drizzle-orm";
import { db, gamesTable, gameParticipantsTable } from "@workspace/db";
import { clearUserStatsCache } from "./stats";
import { writeFinalizedSummary } from "./gameSummaryWriter";
import { logger } from "./logger";

/**
 * Inactivity cutoff — versus games auto-forfeit after this much idle
 * time since their last logged action. Practice is exempt (no opponent
 * to keep waiting). Mirrored on the client as a UX countdown.
 */
export const INACTIVITY_FORFEIT_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Hard wall-clock cap from `startedAt`. Applies to ALL game types
 * (including practice and Shark) — prevents reopening a tab and seeing
 * a multi-hour timer when the game should have ended at the 1-hour mark.
 */
export const MAX_GAME_DURATION_MS = 60 * 60 * 1000; // 60 minutes

type GameRow = typeof gamesTable.$inferSelect;

/**
 * Finalize a single in-progress row.
 *  - Versus modes: derive a winner (opponent of whoever was on the
 *    table) and mark outcome `forfeit`.
 *  - Practice: no winner, outcome `expired`.
 * `reason` is folded into gameState so the history view / downstream
 * consumers can distinguish inactivity from a hard-cap closure.
 */
async function finalizeStaleRow(row: GameRow, reason: string, now: Date): Promise<void> {
  const gs = row.gameState as {
    players?: { name: string }[];
    currentPlayerIndex?: number;
  } | null;
  let winner: string | null = null;
  let forfeitingPlayer: string | null = null;
  const players = gs?.players;
  const idx = gs?.currentPlayerIndex;
  if (Array.isArray(players) && players.length > 1 && typeof idx === "number") {
    forfeitingPlayer = players[idx]?.name ?? null;
    winner = players[(idx + 1) % players.length]?.name ?? null;
  }
  const isPractice = row.gameType === "practice";
  // CAS-style guard — only finalize if the row is still in-progress.
  // Prevents a sweep from clobbering a legitimate client-submitted
  // outcome (won/lost/completed) that landed between SELECT and UPDATE.
  const finalized = await db
    .update(gamesTable)
    .set({
      endedAt: now,
      outcome: isPractice ? "expired" : "forfeit",
      winner,
      gameState: {
        ...((row.gameState as Record<string, unknown> | null) ?? {}),
        forfeitReason: reason,
        forfeitedPlayer: forfeitingPlayer,
      },
    })
    .where(and(eq(gamesTable.id, row.id), isNull(gamesTable.endedAt)))
    .returning({ id: gamesTable.id });
  // Only bust caches when this sweep actually closed the row (the CAS guard
  // may have lost to a client-submitted outcome). Clearing each participant's
  // cached personal stats lets live views (the /watch/{name} profile header)
  // reflect the just-expired game on their next poll.
  if (finalized.length > 0) {
    // Distill the now-finalized game into its authoritative summaries.
    // Best-effort: the idempotent backfill can repair a miss, and reads treat
    // an empty summary as "absent", so never let this block the sweep.
    try {
      await writeFinalizedSummary(row.id);
    } catch (err) {
      logger.warn({ gameId: row.id, err }, "Failed to write game summary");
    }
    const parts = await db
      .select({ userId: gameParticipantsTable.userId })
      .from(gameParticipantsTable)
      .where(eq(gameParticipantsTable.gameId, row.id));
    for (const p of parts) {
      if (p.userId) clearUserStatsCache(p.userId);
    }
  }
}

/**
 * Drizzle predicate matching in-progress rows that should be closed:
 *  - hard wall-clock cap exceeded (any gameType, including practice), OR
 *  - inactivity cutoff exceeded (non-practice only).
 */
function stalePredicate(now: Date) {
  const inactivityCutoff = new Date(now.getTime() - INACTIVITY_FORFEIT_MS);
  const startedCutoff = new Date(now.getTime() - MAX_GAME_DURATION_MS);
  return and(
    isNull(gamesTable.endedAt),
    or(
      lt(gamesTable.startedAt, startedCutoff),
      and(
        ne(gamesTable.gameType, "practice"),
        lt(gamesTable.lastActivityAt, inactivityCutoff),
      ),
    ),
  );
}

function reasonFor(row: GameRow, now: Date): string {
  const overCap = row.startedAt.getTime() + MAX_GAME_DURATION_MS <= now.getTime();
  return overCap ? "max_duration_60min" : "inactivity_60min";
}

/**
 * Pure single-row staleness check — the JS mirror of `stalePredicate` for a
 * row that's already been fetched. Lets a read path decide whether the ONE
 * game a viewer is looking at should be finalized, without scanning all of a
 * user's games on every poll.
 */
export function isRowStale(row: GameRow, now: Date = new Date()): boolean {
  if (row.endedAt) return false;
  if (row.startedAt.getTime() + MAX_GAME_DURATION_MS <= now.getTime()) return true;
  if (row.gameType !== "practice") {
    if (row.lastActivityAt.getTime() + INACTIVITY_FORFEIT_MS <= now.getTime()) return true;
  }
  return false;
}

/**
 * Finalize a single already-fetched in-progress row IFF it is stale. Returns
 * true when it (was stale and) closed the row. Used by the polled spectator
 * read paths (/games/state, /games/watch-resolve) so an idle game is closed
 * lazily — on the next view — instead of by a per-user full sweep every poll.
 */
export async function finalizeGameIfStale(
  row: GameRow,
  now: Date = new Date(),
): Promise<boolean> {
  if (!isRowStale(row, now)) return false;
  await finalizeStaleRow(row, reasonFor(row, now), now);
  return true;
}

/**
 * Sweep stale in-progress games for a single user. Invoked lazily by
 * /games/start, /games/activity, /games/save, /games/resume, and
 * /games/history so a user touching the API never sees a stale row.
 */
export async function sweepStaleGames(userId: string, now: Date = new Date()): Promise<number> {
  const candidates = await db
    .select()
    .from(gamesTable)
    .where(and(eq(gamesTable.userId, userId), stalePredicate(now)));
  if (candidates.length === 0) return 0;
  for (const row of candidates) {
    await finalizeStaleRow(row, reasonFor(row, now), now);
  }
  return candidates.length;
}

/** True when the given start time is past the hard wall-clock cap. */
export function isPastHardCap(startedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - startedAt.getTime() >= MAX_GAME_DURATION_MS;
}
