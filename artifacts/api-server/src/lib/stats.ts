import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { db, gamesTable, gameParticipantsTable, usersTable, passesTable, subscriptionsTable } from "@workspace/db";
import { resolveUserProfileBackgrounds } from "./userProfileBackground";
import type { BackgroundVariant } from "./profileBackground";
import { isAdminEmail } from "./config";
import { logger } from "./logger";
import { readGameSummary, readParticipantSummary } from "./gameSummary";

/**
 * Server-side statistics aggregation for the /stats endpoint.
 *
 * These aggregations NEVER parse the heavy `gameState.shotLog`. Every finished
 * game carries an authoritative distilled summary written once at finalize: a
 * game-level `games.summary` (ALL-players totals + 8-ball terminal flags) and a
 * per-slot `game_participants.summary` (per-window BPM / accuracy / event counts
 * / ball histogram). The bulk read paths here select those summary columns plus
 * the denormalized scalar columns (bpm / accuracy / durationMs / outcome) and
 * the promoted discriminator columns (sharkAggression / chaosMode / ruleSet),
 * so a stats/leaderboard pass is pure column reads. A row whose summary is
 * absent or a stale version (`readGameSummary`/`readParticipantSummary` → null)
 * is skipped, never mis-read ("absent not corrupt").
 *
 * The per-player BPM / accuracy math lives in the shared pure module
 * `gameSummary.ts` (which mirrors `gameLogic.ts`); it runs at finalize, not
 * here. Keep `gameSummary.ts` and `gameLogic.ts` in lockstep if scoring changes.
 */

export type StatWindow = "24h" | "30d" | "365d" | "all";
export type StatScope = "personal" | "global";
export type StatGameMode = "all" | "8ball" | "9ball" | "practice" | "shark";

/**
 * The single stats/export window granted to the free (account) tier. Both the
 * `/stats` clamp (personal scope) and the `/games/export` cap key off this so
 * the two stay in lockstep if the free window ever changes.
 */
export const FREE_TIER_WINDOW: StatWindow = "24h";

const SHARK_PLAYER_NAME = "Shark";

/** 1-hour cache TTL — global + free-personal snapshots may be up to an hour stale. */
const STATS_CACHE_TTL_MS = 60 * 60 * 1000;

/** Cap on the BPM trend sparkline series (last N games, oldest→newest). */
const TREND_MAX = 24;

export interface StatsCore {
  gamesPlayed: number;
  winRate: number | null;
  finishRate: number | null;
  eightBallSinkRate: number | null;
  eightBallDecidedGames: number;
  accuracy: number | null;
  bestAccuracy: number | null;
  totalShots: number;
  totalMisses: number;
  totalFouls: number;
  totalSafeties: number;
  totalUndos: number;
  avgShotsPerGame: number;
  avgMissesPerGame: number;
  avgFoulsPerGame: number;
  avgSafetiesPerGame: number;
  avgBpm: number | null;
  bestBpm: number | null;
  trend: Array<{ bpm: number | null; accuracy: number | null }>;
  playTimeByType: Array<{ gameType: "8ball" | "9ball" | "practice" | "shark"; avgDurationMs: number; gameCount: number }>;
  topBalls: Array<{ ball: number; count: number }>;
  solidsCount: number;
  stripesCount: number;
  sharkWinRate: number | null;
  sharkGames: number;
  sharkLevel: number | null;
  // True when the caller WON at least one Chaos ("No Rules") game within their
  // 10 most-recent completed games (window-independent). Cosmetic only — drives
  // the rainbow AVG-BPM flourish on the Stats hero. Always false for global scope.
  chaosWinRecent: boolean;
  // 8-ball wins in the last 24 hours for this user (personal scope only; 0 for
  // global scope). Drives the wins-today ball chip on the hero and Account card.
  winsToday: number;
  computedAt: number;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export function windowCutoff(window: StatWindow): Date | null {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  switch (window) {
    case "24h":
      return new Date(now - day);
    case "30d":
      return new Date(now - 30 * day);
    case "365d":
      return new Date(now - 365 * day);
    case "all":
      return null;
  }
}

/**
 * The summary-bearing column shape every bulk read selects. NEVER includes
 * `gameState` — the whole point is that aggregations read the distilled
 * `summary` (+ the denormalized scalar/discriminator columns) instead of
 * parsing the heavy shot log. `summary` is read through `readGameSummary`;
 * `sharkAggression` is the promoted discriminator (non-null ⇒ Shark game).
 */
interface RowLike {
  gameType: string;
  durationMs: number;
  outcome: string | null;
  winner: string | null;
  bpm: number | null;
  accuracy: number | null;
  sharkAggression: string | null;
  summary: unknown;
  endedAt: Date | null;
}

function emptyCore(): StatsCore {
  return {
    gamesPlayed: 0,
    winRate: null,
    finishRate: null,
    eightBallSinkRate: null,
    eightBallDecidedGames: 0,
    accuracy: null,
    bestAccuracy: null,
    totalShots: 0,
    totalMisses: 0,
    totalFouls: 0,
    totalSafeties: 0,
    totalUndos: 0,
    avgShotsPerGame: 0,
    avgMissesPerGame: 0,
    avgFoulsPerGame: 0,
    avgSafetiesPerGame: 0,
    avgBpm: null,
    bestBpm: null,
    trend: [],
    playTimeByType: [],
    topBalls: [],
    solidsCount: 0,
    stripesCount: 0,
    sharkWinRate: null,
    sharkGames: 0,
    sharkLevel: null,
    chaosWinRecent: false,
    winsToday: 0,
    computedAt: Date.now(),
  };
}

/**
 * Count the number of completed standard 8-ball wins for a user in the last
 * 24 hours. "Win" means the game's `winner` column matches the user's
 * `displayName` in that game. Shark and Chaos games are excluded (they are
 * flagged by top-level keys in the gameState JSONB). Used by personal stats,
 * leaderboard rows, and the GetMe Account object to drive the wins-today chip.
 */
export async function countEightBallWinsToday(userId: string): Promise<number> {
  const cutoff = windowCutoff("24h") as Date;
  const rows = await db
    .select({ c: count() })
    .from(gamesTable)
    .innerJoin(
      gameParticipantsTable,
      and(
        eq(gameParticipantsTable.gameId, gamesTable.id),
        eq(gameParticipantsTable.userId, userId),
      ),
    )
    .where(
      and(
        isNotNull(gamesTable.endedAt),
        gte(gamesTable.endedAt, cutoff),
        eq(gamesTable.gameType, "8ball"),
        isNull(gamesTable.sharkAggression),
        isNull(gamesTable.chaosMode),
        eq(gamesTable.winner, gameParticipantsTable.displayName),
      ),
    );
  return Number(rows[0]?.c ?? 0);
}

function rollUpPlayTime(
  byType: Map<string, { total: number; count: number }>,
): StatsCore["playTimeByType"] {
  const order: Array<"8ball" | "9ball" | "practice" | "shark"> = ["8ball", "9ball", "practice", "shark"];
  const out: StatsCore["playTimeByType"] = [];
  for (const gt of order) {
    const agg = byType.get(gt);
    if (!agg || agg.count === 0) continue;
    out.push({ gameType: gt, avgDurationMs: Math.round(agg.total / agg.count), gameCount: agg.count });
  }
  return out;
}

/** One raw, pre-aggregation trend sample: a single game's pace/accuracy plus
 *  when it ended (used to bucket games into per-period points). */
interface RawTrendPoint {
  endedAt: number;
  bpm: number | null;
  accuracy: number | null;
}

/**
 * Collapse raw per-game trend samples (newest-first) into the chart series the
 * hero plots, with a granularity that follows the selected window so widening
 * the window genuinely reshapes the line instead of re-showing the same recent
 * games:
 *   - 24h  → per-game, the most recent TREND_MAX games
 *   - 30d  → one point per calendar day (UTC), averaged, last 31 days
 *   - 365d → one point per calendar month (UTC), averaged, last 12 months
 *   - all  → one point per calendar month (UTC), averaged, last 24 months
 * Bucketing naturally bounds the point count regardless of how many games fall
 * in the window. Each bucket averages BPM and accuracy independently (skipping
 * the null side) so a game missing one metric still contributes the other.
 * Returns points oldest→newest so the chart reads left-to-right.
 */
function buildWindowedTrend(
  points: RawTrendPoint[],
  window: StatWindow,
): Array<{ bpm: number | null; accuracy: number | null }> {
  if (window === "24h") {
    return points
      .slice(0, TREND_MAX)
      .reverse()
      .map((p) => ({ bpm: p.bpm, accuracy: p.accuracy }));
  }
  const byDay = window === "30d";
  const maxBuckets = window === "30d" ? 31 : window === "365d" ? 12 : 24;
  // points are newest-first, so each bucket is first created by its newest game
  // → the Map's insertion order is newest-bucket-first.
  const buckets = new Map<
    string,
    { bpmSum: number; bpmN: number; accSum: number; accN: number }
  >();
  for (const p of points) {
    const d = new Date(p.endedAt);
    const key = byDay
      ? `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
      : `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    let b = buckets.get(key);
    if (!b) {
      b = { bpmSum: 0, bpmN: 0, accSum: 0, accN: 0 };
      buckets.set(key, b);
    }
    if (p.bpm != null) {
      b.bpmSum += p.bpm;
      b.bpmN += 1;
    }
    if (p.accuracy != null) {
      b.accSum += p.accuracy;
      b.accN += 1;
    }
  }
  return [...buckets.values()]
    .slice(0, maxBuckets)
    .reverse()
    .map((b) => ({
      bpm: b.bpmN > 0 ? round1(b.bpmSum / b.bpmN) : null,
      accuracy: b.accN > 0 ? Math.round(b.accSum / b.accN) : null,
    }));
}

async function computeGlobalStats(window: StatWindow, gameMode: StatGameMode): Promise<StatsCore> {
  const cutoff = windowCutoff(window);
  const conds = [isNotNull(gamesTable.endedAt)];
  if (cutoff) conds.push(gte(gamesTable.endedAt, cutoff));
  // SQL-side game type filter. Shark and 8ball both fetch "8ball" rows and are
  // discriminated in-loop via the promoted `sharkAggression` discriminator column.
  if (gameMode === "9ball") conds.push(eq(gamesTable.gameType, "9ball"));
  else if (gameMode === "practice") conds.push(eq(gamesTable.gameType, "practice"));
  else if (gameMode === "8ball" || gameMode === "shark") conds.push(eq(gamesTable.gameType, "8ball"));
  const rows = (await db
    .select({
      gameType: gamesTable.gameType,
      durationMs: gamesTable.durationMs,
      outcome: gamesTable.outcome,
      winner: gamesTable.winner,
      bpm: gamesTable.bpm,
      accuracy: gamesTable.accuracy,
      sharkAggression: gamesTable.sharkAggression,
      summary: gamesTable.summary,
      endedAt: gamesTable.endedAt,
    })
    .from(gamesTable)
    .where(and(...conds))
    .orderBy(desc(gamesTable.endedAt))) as RowLike[];

  const core = emptyCore();
  if (rows.length === 0) return core;

  const byType = new Map<string, { total: number; count: number }>();
  const bpms: number[] = [];
  const accuracies: number[] = [];
  // Raw per-game trend samples (newest-first); bucketed by window at the end.
  const trend: RawTrendPoint[] = [];
  let finished = 0;
  let eightDecided = 0;
  let eightClean = 0;
  // Rows skipped because their summary is absent / a stale version. These are
  // excluded from BOTH the numerator and the denominator ("absent not corrupt"),
  // so a transient finalize miss (or a future summary-version bump before the
  // backfill reruns) cleanly omits the row instead of skewing the averages.
  // Discriminated-out games (shark/8ball) are NOT skipped here — they `continue`
  // before the summary read and stay in `gamesPlayed`, matching legacy.
  let summaryless = 0;

  for (const r of rows) {
    // Shark/8ball in-loop discrimination — the promoted discriminator column
    // (SQL can only filter by gameType "8ball"). Done BEFORE the summary read so
    // a discriminated-out game never reads its summary (matches legacy ordering).
    const isShark = r.sharkAggression != null;
    if (gameMode === "8ball" && isShark) continue;
    if (gameMode === "shark" && !isShark) continue;
    // Authoritative distilled summary — never parse the shot log. Absent / stale
    // version → skip + log ("absent not corrupt"); never happens on finalized rows.
    const gsum = readGameSummary(r.summary);
    if (!gsum) {
      summaryless += 1;
      logger.warn({ gameType: r.gameType }, "global stats: skipping game with missing summary");
      continue;
    }
    // Completion vs abandonment (forfeit / inactivity-expiry).
    if (r.outcome === "won" || r.outcome === "lost" || r.outcome === "completed") finished += 1;
    // Pace + accuracy from denormalized columns.
    const gameBpm = r.bpm != null ? r.bpm / 10 : null;
    const gameAccuracy = r.accuracy != null ? r.accuracy : null;
    if (gameBpm != null) bpms.push(gameBpm);
    if (gameAccuracy != null) accuracies.push(gameAccuracy);
    // One aligned trend point per game with any data (lockstep across series).
    if ((gameBpm != null || gameAccuracy != null) && r.endedAt)
      trend.push({ endedAt: r.endedAt.getTime(), bpm: gameBpm, accuracy: gameAccuracy });
    // Play time grouped by type. Shark games are stored as "8ball" but bucket
    // under their own "shark" slice so the Game Modes breakdown shows them.
    const playTimeKey = isShark ? "shark" : r.gameType;
    const agg = byType.get(playTimeKey) ?? { total: 0, count: 0 };
    agg.total += r.durationMs;
    agg.count += 1;
    byType.set(playTimeKey, agg);
    // Event counts (all players) from the game-level summary.
    core.totalShots += gsum.totalShots;
    core.totalMisses += gsum.totalMisses;
    core.totalFouls += gsum.totalFouls;
    core.totalSafeties += gsum.totalSafeties;
    core.totalUndos += gsum.undoCount;
    // 8-ball decided-on-the-8 rate (game-level terminal, all players).
    if (r.gameType === "8ball" && gsum.eightDecided) {
      eightDecided += 1;
      if (gsum.eightClean) eightClean += 1;
    }
  }

  // Denominator = rows actually aggregated. Equals legacy `rows.length` whenever
  // every row carries a summary (the steady state after backfill); only a
  // genuinely summaryless row is dropped from it.
  core.gamesPlayed = rows.length - summaryless;
  const gp = core.gamesPlayed;
  core.finishRate = gp > 0 ? round3(finished / gp) : null;
  core.winRate = null; // meaningless globally
  core.eightBallDecidedGames = eightDecided;
  core.eightBallSinkRate = eightDecided > 0 ? round3(eightClean / eightDecided) : null;
  core.accuracy = accuracies.length > 0 ? Math.round(accuracies.reduce((a, b) => a + b, 0) / accuracies.length) : null;
  core.bestAccuracy = accuracies.length > 0 ? Math.max(...accuracies) : null;
  core.avgBpm = bpms.length > 0 ? round1(bpms.reduce((a, b) => a + b, 0) / bpms.length) : null;
  core.bestBpm = bpms.length > 0 ? round1(Math.max(...bpms)) : null;
  // Bucket the raw samples into per-period points sized to the window.
  core.trend = buildWindowedTrend(trend, window);
  core.avgShotsPerGame = gp > 0 ? round1(core.totalShots / gp) : 0;
  core.avgMissesPerGame = gp > 0 ? round1(core.totalMisses / gp) : 0;
  core.avgFoulsPerGame = gp > 0 ? round1(core.totalFouls / gp) : 0;
  core.avgSafetiesPerGame = gp > 0 ? round1(core.totalSafeties / gp) : 0;
  core.playTimeByType = rollUpPlayTime(byType);
  // Ball patterns + solids/stripes + shark are personal-only — left at defaults.
  core.computedAt = Date.now();
  return core;
}

async function computePersonalStats(userId: string, window: StatWindow, gameMode: StatGameMode): Promise<StatsCore> {
  const cutoff = windowCutoff(window);
  const parts = await db
    .select({
      gameId: gameParticipantsTable.gameId,
      displayName: gameParticipantsTable.displayName,
      summary: gameParticipantsTable.summary,
    })
    .from(gameParticipantsTable)
    .where(eq(gameParticipantsTable.userId, userId));

  const core = emptyCore();
  if (parts.length === 0) return core;

  const partByGame = new Map(parts.map((p) => [p.gameId, p]));
  const ids = parts.map((p) => p.gameId);
  const conds = [inArray(gamesTable.id, ids), isNotNull(gamesTable.endedAt)];
  if (cutoff) conds.push(gte(gamesTable.endedAt, cutoff));
  // SQL-side game type filter. Shark and 8ball both fetch "8ball" rows and are
  // discriminated in-loop via the promoted `sharkAggression` discriminator column.
  if (gameMode === "9ball") conds.push(eq(gamesTable.gameType, "9ball"));
  else if (gameMode === "practice") conds.push(eq(gamesTable.gameType, "practice"));
  else if (gameMode === "8ball" || gameMode === "shark") conds.push(eq(gamesTable.gameType, "8ball"));
  const rows = (await db
    .select({
      id: gamesTable.id,
      gameType: gamesTable.gameType,
      durationMs: gamesTable.durationMs,
      outcome: gamesTable.outcome,
      winner: gamesTable.winner,
      bpm: gamesTable.bpm,
      accuracy: gamesTable.accuracy,
      sharkAggression: gamesTable.sharkAggression,
      summary: gamesTable.summary,
      endedAt: gamesTable.endedAt,
    })
    .from(gamesTable)
    .where(and(...conds))
    .orderBy(desc(gamesTable.endedAt))) as Array<RowLike & { id: string }>;

  // Recent-chaos-win flag (cosmetic — drives the rainbow AVG-BPM flourish).
  // Computed BEFORE the empty-window early return because it is
  // window-independent: it looks at the caller's 10 most-recent COMPLETED games
  // overall (not the selected window), so a user with no games in the current
  // window can still be eligible (e.g. the fixed-24h /watch profile, or a 24h
  // /stats request after an idle day). Chaos games are flagged by the promoted
  // `chaosMode` discriminator column; a win is the game's `winner`
  // matching the caller's slot name (same convention as the Shark win count).
  // The Chaos `none` variant and ties store `winner = null`, so they correctly
  // never trigger it.
  const recentRows = await db
    .select({
      winner: gamesTable.winner,
      displayName: gameParticipantsTable.displayName,
      chaosMode: gamesTable.chaosMode,
    })
    .from(gamesTable)
    .innerJoin(
      gameParticipantsTable,
      and(
        eq(gameParticipantsTable.gameId, gamesTable.id),
        eq(gameParticipantsTable.userId, userId),
      ),
    )
    .where(and(inArray(gamesTable.id, ids), isNotNull(gamesTable.endedAt)))
    .orderBy(desc(gamesTable.endedAt))
    .limit(10);
  core.chaosWinRecent = recentRows.some(
    (r) => r.chaosMode != null && r.winner != null && r.winner === r.displayName,
  );

  // Wins-today (window-independent, always 24h). Computed before the
  // rows-empty guard so the chip shows even when no games fall in the
  // selected window (e.g. the fixed-24h /watch hero with a 30d stats view).
  core.winsToday = await countEightBallWinsToday(userId);

  if (rows.length === 0) return core;

  const byType = new Map<string, { total: number; count: number }>();
  const bpms: number[] = [];
  const accs: number[] = [];
  // Raw per-game trend samples (newest-first); bucketed by window at the end.
  const trend: RawTrendPoint[] = [];
  const ballCounts = new Map<number, number>();
  let totalMade = 0;
  let totalAttempts = 0;
  let bestAccuracy: number | null = null;
  let nonPracticeGames = 0;
  let wins = 0;
  let eightDecided = 0;
  let eightClean = 0;
  let sharkWins = 0;
  // Rows skipped because a summary (per-slot or game-level) is absent / a stale
  // version. Excluded from BOTH numerator and denominator ("absent not corrupt").
  // Discriminated-out games (shark/8ball) are NOT counted here — they `continue`
  // before the summary read and stay in `gamesPlayed`, matching legacy.
  let summaryless = 0;

  for (const r of rows) {
    // Shark/8ball in-loop discrimination — the promoted discriminator column
    // (SQL can only filter by gameType "8ball"). Done BEFORE the summary read so
    // a discriminated-out game never reads its summary (matches legacy ordering).
    const isShark = r.sharkAggression != null;
    if (gameMode === "8ball" && isShark) continue;
    if (gameMode === "shark" && !isShark) continue;

    // Authoritative per-slot + game-level summaries — never parse the shot log.
    // Absent / stale version → skip + log; never happens on finalized rows.
    const part = partByGame.get(r.id);
    const displayName = part?.displayName ?? "";
    const psum = readParticipantSummary(part?.summary);
    const gsum = readGameSummary(r.summary);
    if (!psum || !gsum) {
      summaryless += 1;
      logger.warn({ gameId: r.id }, "personal stats: skipping game with missing summary");
      continue;
    }

    // Pace (per-participant stats window, from the slot summary).
    const bpm = psum.statsBpmX10 != null ? psum.statsBpmX10 / 10 : null;
    if (bpm != null) bpms.push(bpm);

    // Accuracy (pooled ratio + per-game best).
    const made = psum.made;
    const attempts = psum.attempts;
    totalMade += made;
    totalAttempts += attempts;
    const gameAccuracy = attempts > 0 ? Math.round((made / attempts) * 100) : null;
    if (gameAccuracy != null) {
      accs.push(gameAccuracy);
      bestAccuracy = bestAccuracy == null ? gameAccuracy : Math.max(bestAccuracy, gameAccuracy);
    }

    // One aligned trend point per game with any data (lockstep across series).
    if ((bpm != null || gameAccuracy != null) && r.endedAt)
      trend.push({ endedAt: r.endedAt.getTime(), bpm, accuracy: gameAccuracy });

    // Event counts (own shots only) from the per-slot summary.
    core.totalShots += psum.shotCount;
    core.totalMisses += psum.missCount;
    core.totalFouls += psum.foulCount;
    core.totalSafeties += psum.safetyCount;
    // Top balls — pockets only (sink / terminal win), keyed by ball number.
    for (const [ball, c] of Object.entries(psum.ballCounts)) {
      const n = Number(ball);
      ballCounts.set(n, (ballCounts.get(n) ?? 0) + c);
    }
    core.totalUndos += gsum.undoCount;

    // Play time grouped by type (whole-game duration). Shark games are stored as
    // "8ball" but bucket under their own "shark" slice in the Game Modes breakdown.
    const playTimeKey = isShark ? "shark" : r.gameType;
    const agg = byType.get(playTimeKey) ?? { total: 0, count: 0 };
    agg.total += r.durationMs;
    agg.count += 1;
    byType.set(playTimeKey, agg);

    // Win/Loss — non-practice only.
    if (r.gameType !== "practice") {
      nonPracticeGames += 1;
      if (r.winner != null && r.winner === displayName) wins += 1;
    }

    // 8-ball decided-on-the-8 (own attempts only) + solids/stripes.
    if (r.gameType === "8ball") {
      if (psum.eightDecided) {
        eightDecided += 1;
        if (psum.eightClean) eightClean += 1;
      }
      // Solids vs stripes — only when a group was locked in for this player.
      if (psum.team === "solids") core.solidsCount += 1;
      else if (psum.team === "stripes") core.stripesCount += 1;
    }

    // Shark mode — solo, the caller is the lone human.
    if (isShark) {
      core.sharkGames += 1;
      if (r.winner === displayName && r.winner !== SHARK_PLAYER_NAME) sharkWins += 1;
    }
  }

  core.accuracy = totalAttempts > 0 ? Math.round((totalMade / totalAttempts) * 100) : null;
  core.bestAccuracy = bestAccuracy;
  core.avgBpm = bpms.length > 0 ? round1(bpms.reduce((a, b) => a + b, 0) / bpms.length) : null;
  core.bestBpm = bpms.length > 0 ? round1(Math.max(...bpms)) : null;
  // Bucket the raw samples into per-period points sized to the window.
  core.trend = buildWindowedTrend(trend, window);
  // Denominator = rows actually aggregated. Equals legacy `rows.length` whenever
  // every row carries a summary (the steady state after backfill); only a
  // genuinely summaryless row is dropped from it.
  core.gamesPlayed = rows.length - summaryless;
  const gp = core.gamesPlayed;
  core.avgShotsPerGame = gp > 0 ? round1(core.totalShots / gp) : 0;
  core.avgMissesPerGame = gp > 0 ? round1(core.totalMisses / gp) : 0;
  core.avgFoulsPerGame = gp > 0 ? round1(core.totalFouls / gp) : 0;
  core.avgSafetiesPerGame = gp > 0 ? round1(core.totalSafeties / gp) : 0;
  core.winRate = nonPracticeGames > 0 ? round3(wins / nonPracticeGames) : null;
  core.finishRate = null; // global-only
  core.eightBallDecidedGames = eightDecided;
  core.eightBallSinkRate = eightDecided > 0 ? round3(eightClean / eightDecided) : null;
  core.playTimeByType = rollUpPlayTime(byType);
  core.topBalls = [...ballCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 3)
    .map(([ball, count]) => ({ ball, count }));
  core.sharkWinRate = core.sharkGames > 0 ? round3(sharkWins / core.sharkGames) : null;

  // Shark Level is the user's ALL-TIME count of Shark-mode WINS — only games
  // the caller actually beat the Shark in, not every Shark game played
  // (window-independent, unlike sharkGames above). Shark games are flagged by
  // the promoted `sharkAggression` discriminator column; a win is the game's
  // `winner` matching the caller's slot name. Count in SQL across every game the
  // caller participated in, regardless of the window.
  const sharkRows = await db
    .select({ c: count() })
    .from(gamesTable)
    .innerJoin(
      gameParticipantsTable,
      and(
        eq(gameParticipantsTable.gameId, gamesTable.id),
        eq(gameParticipantsTable.userId, userId),
      ),
    )
    .where(
      and(
        inArray(gamesTable.id, ids),
        isNotNull(gamesTable.endedAt),
        isNotNull(gamesTable.sharkAggression),
        eq(gamesTable.winner, gameParticipantsTable.displayName),
        ne(gamesTable.winner, SHARK_PLAYER_NAME),
      ),
    );
  core.sharkLevel = Number(sharkRows[0]?.c ?? 0);

  core.computedAt = Date.now();
  return core;
}

interface CacheEntry {
  core: StatsCore;
  expiresAt: number;
}
const statsCache = new Map<string, CacheEntry>();

/**
 * Resolve stats for the given scope/window, using a 1-hour in-memory cache.
 * `refresh` bypasses and repopulates the cache for the requested key (the
 * route gates this behind the pass tier). Returns whether the result was a
 * cache hit so the client can label staleness.
 */
export async function resolveStats(
  scope: StatScope,
  window: StatWindow,
  userId: string | null,
  refresh: boolean,
  gameMode: StatGameMode = "all",
): Promise<{ core: StatsCore; cached: boolean }> {
  const key =
    scope === "global"
      ? `global:${window}:${gameMode}`
      : `personal:${userId}:${window}:${gameMode}`;
  const now = Date.now();
  if (!refresh) {
    const hit = statsCache.get(key);
    if (hit && hit.expiresAt > now) return { core: hit.core, cached: true };
  }
  const core =
    scope === "global"
      ? await computeGlobalStats(window, gameMode)
      : await computePersonalStats(userId as string, window, gameMode);
  statsCache.set(key, { core, expiresAt: now + STATS_CACHE_TTL_MS });
  return { core, cached: false };
}

/**
 * Drop every cached personal-stats snapshot for a user (all windows). Called
 * after the user deletes their game data so the /stats endpoint recomputes
 * immediately (showing empty stats) rather than serving up-to-1h-stale
 * cached numbers — important for free/account-tier users who cannot force a
 * refresh themselves.
 */
export function clearUserStatsCache(userId: string): void {
  const prefix = `personal:${userId}:`;
  for (const key of statsCache.keys()) {
    if (key.startsWith(prefix)) statsCache.delete(key);
  }
}

/**
 * Drop EVERY cached stats snapshot — personal (all users) and global (all
 * windows). Used after an admin-triggered global summary backfill rewrites many
 * games at once, so the next read recomputes against the freshly distilled rows
 * instead of serving up-to-1h-stale numbers (notably the global averages).
 */
export function clearAllStatsCache(): void {
  statsCache.clear();
}

// ───────────────────────── Leaderboard ─────────────────────────
//
// A pace (Balls-Per-Minute) ranking over a deliberately narrow, apples-to-
// apples slice of games so the numbers are comparable: standard 8-ball,
// 1-versus-1 singles (maxPlayers === 2), opened on the break (the
// `open-through-break` ruleSet). 9-ball, Practice, Shark, 4-player / team,
// chaos and manual-team games are all excluded. Only registered players
// (game_participants with a non-null userId) can appear.
//
// A player's score is the average BPM of their best few qualifying games, with
// a matching average accuracy over those same games. Physically implausible
// per-game paces (sub-millisecond sinks → 0, or absurdly fast runs) are
// discarded before ranking, and a player needs a minimum number of qualifying
// games to appear at all. The full ranking is computed once per window and
// cached for one hour (the same TTL as /stats); the route slices pages from it.

export type LeaderboardWindow = "30d" | "90d" | "all";

/**
 * Which game pool a leaderboard ranks. 8-ball and 9-ball each rank their own
 * separate pool with the same balancing rules — they are NEVER merged into one
 * combined list.
 */
export type LeaderboardMode = "8ball" | "9ball";

export interface LeaderboardRow {
  rank: number;
  screenName: string;
  bpm: number;
  accuracy: number | null;
  gamesPlayed: number;
  // All-time completed Shark-mode game count (window-independent), mirroring
  // the profile `sharkLevel`. 0 when the player has no Shark games.
  sharkLevel: number;
  // The player's resolved profile theme/background (same resolution the watch
  // profile uses), so the client can tint the leaderboard card. Null = no theme.
  profileBackground: BackgroundVariant | null;
  // 8-ball wins in the last 24 hours for this player. Drives the wins-today chip.
  winsToday: number;
  // Whether to render this player's name with the rainbow flair — admins always,
  // or any paid ("pass") tier holder whose profileTheme is "rainbow".
  rainbowName: boolean;
}

/**
 * Admin-only view of a ranked player. Carries everything the public row hides:
 * the composite `score` actually ranked on, how many of the player's qualifying
 * games were between two registered players (`trustedGames`), and whether the
 * player is on a thin sample (`provisional`). NEVER returned on any public
 * leaderboard/profile response — admin tooling only, for eyeballing suspicious
 * early ranks.
 */
export interface AdminLeaderboardRow {
  rank: number;
  screenName: string;
  /** Composite ranking value: accuracy-weighted, trust-weighted effective pace. */
  score: number;
  bpm: number;
  accuracy: number | null;
  gamesPlayed: number;
  /** Of the qualifying games, how many had two registered participants. */
  trustedGames: number;
  /** True when the player has too few qualifying games to be "established". */
  provisional: boolean;
}

/** Minimum qualifying games before a player is ranked at all (the reward floor). */
const LEADERBOARD_MIN_GAMES = 2;
/**
 * Qualifying-game count at/above which a ranked player is "established"; below
 * it they are flagged `provisional` (a hidden, admin-only signal — never shown
 * to players). The rank-appears floor stays at LEADERBOARD_MIN_GAMES.
 */
const LEADERBOARD_ESTABLISHED_GAMES = 5;
/** Number of a player's best games averaged into their score. */
const LEADERBOARD_BEST_N = 2;
/**
 * Trust weight applied to a qualifying game's score contribution when the game
 * had only ONE registered player (the opponent was an anonymous guest). Games
 * between two registered accounts get full weight (1.0); guest games are
 * discounted so beating a real, named opponent counts for more than padding a
 * score against an honor-system guest seat.
 */
const LEADERBOARD_GUEST_WEIGHT = 0.85;
/**
 * Minimum balls a player must have pocketed in a 9-ball game for it to count
 * toward their score. 9-ball allows combo / 9-on-the-break wins that pocket a
 * single ball almost instantly, producing a tiny-but-extreme BPM; this floor
 * (on top of the BPM outlier cap) keeps those pace-padding flukes off the board.
 */
const LEADERBOARD_MIN_BALLS_9BALL = 3;
/**
 * Upper bound on a plausible per-game BPM. A sustained pace above this implies
 * sub-second sinks (mis-logged timestamps), so the game is dropped as an
 * outlier rather than letting it distort a player's average.
 */
const LEADERBOARD_MAX_PLAUSIBLE_BPM = 60;

/**
 * Grandfather cutoff for ruleSet-less games. The leaderboard only counts
 * standard 1-on-1 8-ball (`ruleSet = 'open-through-break'`). Games predating
 * the ruleSet field stored NULL, so a NULL ruleSet is allowed ONLY for games
 * that ended before this date — genuinely historical ones. Any game ending on
 * or after it must carry a real ruleSet to qualify, which keeps post-cutoff
 * "None"/manual-team 2-player 8-ball games (no opponent pressure, honor-system
 * ball removal — a BPM pace-padding vector) off the competitive board.
 *
 * The date sits in the clean gap between the last NULL-ruleSet game
 * (2026-06-07) and the first ruleSet-bearing game (2026-06-08).
 */
const LEADERBOARD_NULL_RULESET_CUTOFF = new Date("2026-06-08T00:00:00Z");

function leaderboardCutoff(window: LeaderboardWindow): Date | null {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  switch (window) {
    case "30d":
      return new Date(now - 30 * day);
    case "90d":
      return new Date(now - 90 * day);
    case "all":
      return null;
  }
}

async function computeLeaderboard(
  mode: LeaderboardMode,
  window: LeaderboardWindow,
): Promise<RankedEntry[]> {
  const cutoff = leaderboardCutoff(window);
  // Both modes require a standard 1-on-1 game (no teams, no shark/chaos). The
  // 8-ball-only `ruleSet` grandfather gate keeps post-cutoff "None"/manual-team
  // 2-player 8-ball off the board; 9-ball has no teams so it doesn't apply.
  const conds = [
    isNotNull(gamesTable.endedAt),
    eq(gamesTable.gameType, mode),
    eq(gamesTable.maxPlayers, 2),
    isNull(gamesTable.sharkAggression),
    isNull(gamesTable.chaosMode),
  ];
  if (mode === "8ball") {
    // ruleSet grandfather, EXACTLY mirroring the legacy JSONB filter: a real
    // 'open-through-break', OR a NULL ruleSet only for games that ended before
    // the cutoff. `ruleSet` MUST be a true-NULL column so this distinction holds.
    conds.push(
      or(
        eq(gamesTable.ruleSet, "open-through-break"),
        and(isNull(gamesTable.ruleSet), lt(gamesTable.endedAt, LEADERBOARD_NULL_RULESET_CUTOFF)),
      )!,
    );
  }
  if (cutoff) conds.push(gte(gamesTable.endedAt, cutoff));

  // Only the eligible game IDs are needed — all pace/accuracy comes from each
  // participant's stored summary, never the shot log.
  const rows = await db
    .select({ id: gamesTable.id })
    .from(gamesTable)
    .where(and(...conds))
    .orderBy(desc(gamesTable.endedAt));
  if (rows.length === 0) return [];

  const gameIds = rows.map((r) => r.id);
  // Only registered participants count — guests (userId null) are skipped via
  // the inner join. screenName is the canonical name (also the /watch key),
  // not the per-game displayName, so a renamed player stays one entry.
  const parts = await db
    .select({
      gameId: gameParticipantsTable.gameId,
      userId: gameParticipantsTable.userId,
      screenName: usersTable.screenName,
      summary: gameParticipantsTable.summary,
    })
    .from(gameParticipantsTable)
    .innerJoin(usersTable, eq(gameParticipantsTable.userId, usersTable.id))
    .where(
      and(
        inArray(gameParticipantsTable.gameId, gameIds),
        isNotNull(gameParticipantsTable.userId),
      ),
    );

  const partsByGame = new Map<string, typeof parts>();
  for (const p of parts) {
    const arr = partsByGame.get(p.gameId) ?? [];
    arr.push(p);
    partsByGame.set(p.gameId, arr);
  }

  // Per-user accumulation of qualifying per-game records. Keyed by userId so the
  // same player across renames stays one entry. `contribution` is the composite
  // ranked on (accuracy-weighted, trust-weighted effective pace); `bpm` and
  // `accuracy` are retained for separate display. `trusted` marks a game between
  // two registered players (vs one registered vs an anonymous guest).
  const byUser = new Map<
    string,
    {
      screenName: string;
      games: Array<{ bpm: number; accuracy: number | null; trusted: boolean; contribution: number }>;
    }
  >();

  for (const r of rows) {
    const ps = partsByGame.get(r.id);
    if (!ps) continue;
    // Trust signal: two registered participants present (guests have null userId
    // and are excluded by the inner join, so they never appear in `ps`). One
    // registered participant means the opponent was an anonymous guest seat.
    const trusted = ps.length >= 2;
    for (const p of ps) {
      if (!p.userId) continue;
      // Pace + accuracy from the per-slot summary (stats window) — never the shot
      // log. Absent / stale version → skip + log ("absent not corrupt").
      const psum = readParticipantSummary(p.summary);
      if (!psum) {
        logger.warn({ gameId: r.id }, "leaderboard: skipping participant with missing summary");
        continue;
      }
      const bpm = psum.statsBpmX10 != null ? psum.statsBpmX10 / 10 : null;
      // Drop games with no usable pace or an implausible (outlier) one.
      if (bpm == null || bpm <= 0 || bpm > LEADERBOARD_MAX_PLAUSIBLE_BPM) continue;
      const made = psum.made;
      const attempts = psum.attempts;
      // 9-ball pace-padding guard: a combo / 9-on-the-break win pockets just a
      // ball or two almost instantly. Require a floor of pocketed balls so such
      // tiny-but-extreme-BPM games don't pad a 9-ball score. 8-ball is unaffected.
      if (mode === "9ball" && made < LEADERBOARD_MIN_BALLS_9BALL) continue;
      const accuracy = attempts > 0 ? Math.round((made / attempts) * 100) : null;
      // Effective clean pace: pace scaled by accuracy so winning on rushing
      // alone no longer tops the board. Null accuracy degrades to raw pace
      // (factor 1) rather than dropping the game — in practice a non-null BPM
      // implies attempts > 0, so this is just a defensive fallback.
      const accFactor = accuracy != null ? Math.max(0, Math.min(100, accuracy)) / 100 : 1;
      const trustFactor = trusted ? 1 : LEADERBOARD_GUEST_WEIGHT;
      const contribution = bpm * accFactor * trustFactor;
      const entry = byUser.get(p.userId) ?? { screenName: p.screenName, games: [] };
      entry.games.push({ bpm, accuracy, trusted, contribution });
      byUser.set(p.userId, entry);
    }
  }

  // Qualifying players (>= min games), keeping userId so we can attach each
  // one's all-time Shark-mode count below. Score is the average of the best
  // games by composite contribution; bpm/accuracy are averaged over that same
  // best set for display. `provisional` is a hidden, admin-only thin-sample flag.
  const ranked: Array<{
    userId: string;
    screenName: string;
    score: number;
    bpm: number;
    accuracy: number | null;
    gamesPlayed: number;
    trustedGames: number;
    provisional: boolean;
  }> = [];
  for (const [userId, entry] of byUser.entries()) {
    if (entry.games.length < LEADERBOARD_MIN_GAMES) continue;
    const best = [...entry.games]
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, LEADERBOARD_BEST_N);
    const score = round1(best.reduce((s, g) => s + g.contribution, 0) / best.length);
    const avgBpm = round1(best.reduce((s, g) => s + g.bpm, 0) / best.length);
    const accs = best.map((g) => g.accuracy).filter((a): a is number => a != null);
    const accuracy = accs.length > 0 ? Math.round(accs.reduce((s, a) => s + a, 0) / accs.length) : null;
    const trustedGames = entry.games.filter((g) => g.trusted).length;
    const provisional = entry.games.length < LEADERBOARD_ESTABLISHED_GAMES;
    ranked.push({
      userId,
      screenName: entry.screenName,
      score,
      bpm: avgBpm,
      accuracy,
      gamesPlayed: entry.games.length,
      trustedGames,
      provisional,
    });
  }

  // All-time Shark-mode WIN count per ranked user (window-independent),
  // matching how the profile derives `sharkLevel` — only games the user beat
  // the Shark in, not every Shark game played. Shark games are solo and flagged
  // by the promoted `sharkAggression` discriminator column; a win is the
  // game's `winner` matching the user's slot name. One grouped count covers
  // every ranked user.
  const sharkByUser = new Map<string, number>();
  const rankedUserIds = ranked.map((r) => r.userId);
  if (rankedUserIds.length > 0) {
    const sharkCounts = await db
      .select({ userId: gameParticipantsTable.userId, c: count() })
      .from(gameParticipantsTable)
      .innerJoin(gamesTable, eq(gameParticipantsTable.gameId, gamesTable.id))
      .where(
        and(
          inArray(gameParticipantsTable.userId, rankedUserIds),
          isNotNull(gamesTable.endedAt),
          isNotNull(gamesTable.sharkAggression),
          eq(gamesTable.winner, gameParticipantsTable.displayName),
          ne(gamesTable.winner, SHARK_PLAYER_NAME),
        ),
      )
      .groupBy(gameParticipantsTable.userId);
    for (const sc of sharkCounts) {
      if (sc.userId) sharkByUser.set(sc.userId, Number(sc.c));
    }
  }

  // 24h win count per ranked user, for the SAME mode this board ranks (grouped
  // query, one round-trip). An 8-ball board counts 8-ball wins, a 9-ball board
  // counts 9-ball wins.
  const winsTodayByUser = new Map<string, number>();
  if (rankedUserIds.length > 0) {
    const cutoff = windowCutoff("24h") as Date;
    const winCounts = await db
      .select({ userId: gameParticipantsTable.userId, c: count() })
      .from(gameParticipantsTable)
      .innerJoin(gamesTable, eq(gameParticipantsTable.gameId, gamesTable.id))
      .where(
        and(
          inArray(gameParticipantsTable.userId, rankedUserIds),
          isNotNull(gamesTable.endedAt),
          gte(gamesTable.endedAt, cutoff),
          eq(gamesTable.gameType, mode),
          isNull(gamesTable.sharkAggression),
          isNull(gamesTable.chaosMode),
          eq(gamesTable.winner, gameParticipantsTable.displayName),
        ),
      )
      .groupBy(gameParticipantsTable.userId);
    for (const wc of winCounts) {
      if (wc.userId) winsTodayByUser.set(wc.userId, Number(wc.c));
    }
  }

  // Resolve each ranked player's themed profile background — the SAME resolution
  // the public /watch profile uses — so the client can tint the leaderboard card
  // to the player's theme color. Fully batched: one query for the resolution
  // inputs (email + stored theme), then the batched resolver runs one `passes`
  // query and one `discount_codes` query for the whole ranked set (no per-user
  // N+1). Output is identical to the per-user path; bounded further by the
  // 1-hour leaderboard cache.
  let bgByUser = new Map<string, BackgroundVariant | null>();
  let metaById = new Map<string, { id: string; email: string | null; profileTheme: string | null }>();
  if (rankedUserIds.length > 0) {
    const metaRows = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        profileTheme: usersTable.profileTheme,
      })
      .from(usersTable)
      .where(inArray(usersTable.id, rankedUserIds));
    metaById = new Map(metaRows.map((m) => [m.id, m]));
    bgByUser = await resolveUserProfileBackgrounds(
      rankedUserIds.map((userId) => {
        const m = metaById.get(userId);
        return { userId, email: m?.email, profileTheme: m?.profileTheme };
      }),
    );
  }

  // Resolve which ranked players hold the paid ("pass") tier, so we can light
  // the rainbow name for those who picked the "rainbow" theme (admins always
  // get it). Tier = active one-time pass OR active subscription — mirroring
  // computeEntitlement. Two batched queries cover the whole ranked set.
  const paidUserIds = new Set<string>();
  if (rankedUserIds.length > 0) {
    const now = new Date();
    const nowMs = now.getTime();
    const [passRows, subRows] = await Promise.all([
      db
        .select({ userId: passesTable.userId, startedAt: passesTable.startedAt, durationSeconds: passesTable.durationSeconds })
        .from(passesTable)
        .where(inArray(passesTable.userId, rankedUserIds)),
      db
        .select({ userId: subscriptionsTable.userId, status: subscriptionsTable.status, currentPeriodEnd: subscriptionsTable.currentPeriodEnd })
        .from(subscriptionsTable)
        .where(inArray(subscriptionsTable.userId, rankedUserIds)),
    ]);
    for (const pr of passRows) {
      const started = pr.startedAt.getTime();
      const expires = pr.durationSeconds === null ? Infinity : started + pr.durationSeconds * 1000;
      if (started <= nowMs && expires > nowMs) paidUserIds.add(pr.userId);
    }
    for (const sr of subRows) {
      if (sr.status === "active" && sr.currentPeriodEnd > now) paidUserIds.add(sr.userId);
    }
  }

  const result: RankedEntry[] = ranked.map((r) => {
    const meta = metaById.get(r.userId);
    const isAdmin = isAdminEmail(meta?.email ?? "");
    const isPaid = paidUserIds.has(r.userId);
    const rainbowName = isAdmin || (isPaid && meta?.profileTheme === "rainbow");
    return {
      rank: 0,
      screenName: r.screenName,
      score: r.score,
      bpm: r.bpm,
      accuracy: r.accuracy,
      gamesPlayed: r.gamesPlayed,
      trustedGames: r.trustedGames,
      provisional: r.provisional,
      sharkLevel: sharkByUser.get(r.userId) ?? 0,
      profileBackground: bgByUser.get(r.userId) ?? null,
      winsToday: winsTodayByUser.get(r.userId) ?? 0,
      rainbowName,
    };
  });
  // Rank by composite score desc; tie-break by accuracy desc then name for
  // stability. (Score already folds in pace, accuracy, and trust weighting.)
  result.sort(
    (a, b) =>
      b.score - a.score ||
      (b.accuracy ?? -1) - (a.accuracy ?? -1) ||
      a.screenName.localeCompare(b.screenName),
  );
  result.forEach((r, i) => {
    r.rank = i + 1;
  });
  return result;
}

/**
 * Internal ranked row: the public {@link LeaderboardRow} plus the hidden
 * ranking/anti-cheat signals (`score`, `trustedGames`, `provisional`). Cached as
 * the single source of truth; public resolvers strip the hidden fields, the
 * admin resolver keeps them.
 */
interface RankedEntry extends LeaderboardRow {
  score: number;
  trustedGames: number;
  provisional: boolean;
}

interface LeaderboardCacheEntry {
  rows: RankedEntry[];
  expiresAt: number;
}
const leaderboardCache = new Map<string, LeaderboardCacheEntry>();

/**
 * Drop all cached leaderboard windows/modes. Call after any change that affects
 * a player's ranking appearance (e.g. profile-theme update) so the next
 * request recomputes with the fresh data rather than serving a stale card.
 */
export function clearLeaderboardCache(): void {
  leaderboardCache.clear();
}

/**
 * Resolve the full internal ranking for a mode+window, using the 1-hour cache.
 * Each (mode, window) pair caches independently; the 8-ball and 9-ball boards
 * are never merged.
 */
async function resolveRanked(
  mode: LeaderboardMode,
  window: LeaderboardWindow,
): Promise<RankedEntry[]> {
  const key = `leaderboard:${mode}:${window}`;
  const now = Date.now();
  const hit = leaderboardCache.get(key);
  if (hit && hit.expiresAt > now) return hit.rows;
  const rows = await computeLeaderboard(mode, window);
  leaderboardCache.set(key, { rows, expiresAt: now + STATS_CACHE_TTL_MS });
  return rows;
}

/** Strip the hidden ranking signals — the public leaderboard row only. */
function toPublicRow(e: RankedEntry): LeaderboardRow {
  return {
    rank: e.rank,
    screenName: e.screenName,
    bpm: e.bpm,
    accuracy: e.accuracy,
    gamesPlayed: e.gamesPlayed,
    sharkLevel: e.sharkLevel,
    profileBackground: e.profileBackground,
    winsToday: e.winsToday,
    rainbowName: e.rainbowName,
  };
}

/**
 * Resolve the public ranking for a mode+window (1-hour cache). The route
 * paginates / slices the returned array; the whole ranking is computed once per
 * (mode, window) so per-page and widget reads are cheap. Hidden ranking signals
 * (score/trust/provisional) are stripped — use {@link resolveAdminLeaderboard}
 * for those.
 */
export async function resolveLeaderboard(
  mode: LeaderboardMode,
  window: LeaderboardWindow,
): Promise<LeaderboardRow[]> {
  return (await resolveRanked(mode, window)).map(toPublicRow);
}

/**
 * Admin-only ranking for a mode+window: the public ordering plus the hidden
 * composite `score`, `trustedGames`, and `provisional` flag. Same cache as the
 * public resolver. Callers MUST enforce the admin allowlist before exposing it.
 */
export async function resolveAdminLeaderboard(
  mode: LeaderboardMode,
  window: LeaderboardWindow,
): Promise<AdminLeaderboardRow[]> {
  return (await resolveRanked(mode, window)).map((e) => ({
    rank: e.rank,
    screenName: e.screenName,
    score: e.score,
    bpm: e.bpm,
    accuracy: e.accuracy,
    gamesPlayed: e.gamesPlayed,
    trustedGames: e.trustedGames,
    provisional: e.provisional,
  }));
}
