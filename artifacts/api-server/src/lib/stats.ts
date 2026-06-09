import { and, count, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db, gamesTable, gameParticipantsTable, usersTable } from "@workspace/db";

/**
 * Server-side statistics aggregation for the /stats endpoint.
 *
 * Personal stats can't use the denormalized `games.bpm` / `games.accuracy`
 * columns — those are whole-game/host-centric, not the calling user's — and
 * there is no per-participant BPM column. So personal stats are recomputed
 * per game from the `gameState.shotLog`, attributed to the caller's
 * `game_participants.displayName` and bounded by their `statsStartAt`/`leftAt`
 * window. Global stats lean on SQL-friendly denormalized columns where
 * possible and parse the shot log only for event-count breakdowns.
 *
 * The per-player BPM / accuracy math intentionally mirrors
 * `artifacts/breakbpm/src/lib/gameLogic.ts` (`calculatePlayerBPM`,
 * `playerAccuracyCounts`). It is duplicated here rather than imported because
 * the two live in separate workspace artifacts that must not import each
 * other. Keep the two definitions in lockstep if the scoring rules change.
 */

export type StatWindow = "24h" | "30d" | "365d" | "all";
export type StatScope = "personal" | "global";

/**
 * The single stats/export window granted to the free (account) tier. Both the
 * `/stats` clamp (personal scope) and the `/games/export` cap key off this so
 * the two stay in lockstep if the free window ever changes.
 */
export const FREE_TIER_WINDOW: StatWindow = "24h";

const EIGHT_BALL = 8;
const SHARK_PLAYER_NAME = "Shark";

/** 1-hour cache TTL — global + free-personal snapshots may be up to an hour stale. */
const STATS_CACHE_TTL_MS = 60 * 60 * 1000;

/** Defensive upper bound on rows parsed in one pass (cached, so cheap amortized). */
const MAX_ROWS = 5000;

/** Cap on the BPM trend sparkline series (last N games, oldest→newest). */
const TREND_MAX = 24;

/** Minimal shot-log entry shape parsed out of the gameState JSONB. */
interface ShotEntry {
  type?: string;
  playerName?: string;
  ball?: number;
  isFoul?: boolean;
  timestamp?: number;
}

interface ParsedGameState {
  shotLog: ShotEntry[];
  players: Array<{ name?: string; team?: string }>;
  undoCount: number;
  isShark: boolean;
}

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
  playTimeByType: Array<{ gameType: "8ball" | "9ball" | "practice"; avgDurationMs: number; gameCount: number }>;
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

function parseGameState(raw: unknown): ParsedGameState {
  const gs = (raw ?? {}) as Record<string, unknown>;
  const shotLog = Array.isArray(gs["shotLog"]) ? (gs["shotLog"] as ShotEntry[]) : [];
  const players = Array.isArray(gs["players"])
    ? (gs["players"] as Array<{ name?: string; team?: string }>)
    : [];
  const undoCount = typeof gs["undoCount"] === "number" ? (gs["undoCount"] as number) : 0;
  const isShark = gs["sharkAggression"] !== undefined && gs["sharkAggression"] !== null;
  return { shotLog, players, undoCount, isShark };
}

/** True for any entry that pocketed a ball (sink, or a terminal win/lose that pocketed). */
function isPocket(e: ShotEntry): boolean {
  return typeof e.ball === "number";
}
/** True for any entry that counts as a "shot" (excludes the Shark-wins 'lose' marker). */
function isShot(e: ShotEntry): boolean {
  return isPocket(e) || e.type === "miss" || e.type === "foul" || e.type === "safety" || e.isFoul === true;
}

/**
 * Per-player BPM over an ordered, already-player-filtered entry list. Mirrors
 * `calculatePlayerBPM`: anchored at the player's first pocket, measured to
 * their latest entry. Returns null with no pockets, 0 for sub-millisecond.
 */
function playerBpm(entries: ShotEntry[]): number | null {
  if (entries.length === 0) return null;
  const sinks = entries.filter(isPocket);
  if (sinks.length === 0) return null;
  const firstSinkAt = sinks[0].timestamp ?? 0;
  const lastAt = entries[entries.length - 1].timestamp ?? firstSinkAt;
  const elapsed = (lastAt - firstSinkAt) / 60000;
  if (elapsed < 0.001) return 0;
  return round1(sinks.length / elapsed);
}

/** Per-player {made, attempts}. Mirrors `playerAccuracyCounts`. */
function accuracyCounts(entries: ShotEntry[]): { made: number; attempts: number } {
  const made = entries.filter(isPocket).length;
  const attempts = entries.filter(
    (e) => isPocket(e) || e.type === "miss" || e.type === "foul" || e.isFoul === true,
  ).length;
  return { made, attempts };
}

/** Find this game's terminal 8-ball shot (if any), restricted to `player` when given. */
function eightBallTerminal(
  shotLog: ShotEntry[],
  player: string | null,
): { decided: boolean; clean: boolean } {
  for (const e of shotLog) {
    if (e.ball !== EIGHT_BALL) continue;
    if (e.type !== "win" && e.type !== "lose") continue;
    if (player !== null && e.playerName !== player) continue;
    return { decided: true, clean: e.type === "win" };
  }
  return { decided: false, clean: false };
}

interface RowLike {
  gameType: string;
  durationMs: number;
  outcome: string | null;
  winner: string | null;
  bpm: number | null;
  accuracy: number | null;
  gameState: unknown;
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
    computedAt: Date.now(),
  };
}

function rollUpPlayTime(
  byType: Map<string, { total: number; count: number }>,
): StatsCore["playTimeByType"] {
  const order: Array<"8ball" | "9ball" | "practice"> = ["8ball", "9ball", "practice"];
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

async function computeGlobalStats(window: StatWindow): Promise<StatsCore> {
  const cutoff = windowCutoff(window);
  const conds = [isNotNull(gamesTable.endedAt)];
  if (cutoff) conds.push(gte(gamesTable.endedAt, cutoff));
  const rows = (await db
    .select({
      gameType: gamesTable.gameType,
      durationMs: gamesTable.durationMs,
      outcome: gamesTable.outcome,
      winner: gamesTable.winner,
      bpm: gamesTable.bpm,
      accuracy: gamesTable.accuracy,
      gameState: gamesTable.gameState,
      endedAt: gamesTable.endedAt,
    })
    .from(gamesTable)
    .where(and(...conds))
    .orderBy(desc(gamesTable.endedAt))
    .limit(MAX_ROWS)) as RowLike[];

  const core = emptyCore();
  if (rows.length === 0) return core;
  core.gamesPlayed = rows.length;

  const byType = new Map<string, { total: number; count: number }>();
  const bpms: number[] = [];
  const accuracies: number[] = [];
  // Raw per-game trend samples (newest-first); bucketed by window at the end.
  const trend: RawTrendPoint[] = [];
  let finished = 0;
  let eightDecided = 0;
  let eightClean = 0;

  for (const r of rows) {
    const { shotLog, undoCount } = parseGameState(r.gameState);
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
    // Play time grouped by type.
    const agg = byType.get(r.gameType) ?? { total: 0, count: 0 };
    agg.total += r.durationMs;
    agg.count += 1;
    byType.set(r.gameType, agg);
    // Event counts (all players) from the shot log.
    for (const e of shotLog) {
      if (isShot(e)) core.totalShots += 1;
      if (e.type === "miss") core.totalMisses += 1;
      if (e.type === "foul" || e.isFoul === true) core.totalFouls += 1;
      if (e.type === "safety") core.totalSafeties += 1;
    }
    core.totalUndos += undoCount;
    // 8-ball decided-on-the-8 rate.
    if (r.gameType === "8ball") {
      const t = eightBallTerminal(shotLog, null);
      if (t.decided) {
        eightDecided += 1;
        if (t.clean) eightClean += 1;
      }
    }
  }

  core.finishRate = round3(finished / core.gamesPlayed);
  core.winRate = null; // meaningless globally
  core.eightBallDecidedGames = eightDecided;
  core.eightBallSinkRate = eightDecided > 0 ? round3(eightClean / eightDecided) : null;
  core.accuracy = accuracies.length > 0 ? Math.round(accuracies.reduce((a, b) => a + b, 0) / accuracies.length) : null;
  core.bestAccuracy = accuracies.length > 0 ? Math.max(...accuracies) : null;
  core.avgBpm = bpms.length > 0 ? round1(bpms.reduce((a, b) => a + b, 0) / bpms.length) : null;
  core.bestBpm = bpms.length > 0 ? round1(Math.max(...bpms)) : null;
  // Bucket the raw samples into per-period points sized to the window.
  core.trend = buildWindowedTrend(trend, window);
  core.avgShotsPerGame = round1(core.totalShots / core.gamesPlayed);
  core.avgMissesPerGame = round1(core.totalMisses / core.gamesPlayed);
  core.avgFoulsPerGame = round1(core.totalFouls / core.gamesPlayed);
  core.avgSafetiesPerGame = round1(core.totalSafeties / core.gamesPlayed);
  core.playTimeByType = rollUpPlayTime(byType);
  // Ball patterns + solids/stripes + shark are personal-only — left at defaults.
  core.computedAt = Date.now();
  return core;
}

async function computePersonalStats(userId: string, window: StatWindow): Promise<StatsCore> {
  const cutoff = windowCutoff(window);
  const parts = await db
    .select({
      gameId: gameParticipantsTable.gameId,
      displayName: gameParticipantsTable.displayName,
      statsStartAt: gameParticipantsTable.statsStartAt,
      leftAt: gameParticipantsTable.leftAt,
    })
    .from(gameParticipantsTable)
    .where(eq(gameParticipantsTable.userId, userId));

  const core = emptyCore();
  if (parts.length === 0) return core;

  const partByGame = new Map(parts.map((p) => [p.gameId, p]));
  const ids = parts.map((p) => p.gameId);
  const conds = [inArray(gamesTable.id, ids), isNotNull(gamesTable.endedAt)];
  if (cutoff) conds.push(gte(gamesTable.endedAt, cutoff));
  const rows = (await db
    .select({
      id: gamesTable.id,
      gameType: gamesTable.gameType,
      durationMs: gamesTable.durationMs,
      outcome: gamesTable.outcome,
      winner: gamesTable.winner,
      bpm: gamesTable.bpm,
      accuracy: gamesTable.accuracy,
      gameState: gamesTable.gameState,
      endedAt: gamesTable.endedAt,
    })
    .from(gamesTable)
    .where(and(...conds))
    .orderBy(desc(gamesTable.endedAt))
    .limit(MAX_ROWS)) as Array<RowLike & { id: string }>;

  // Recent-chaos-win flag (cosmetic — drives the rainbow AVG-BPM flourish).
  // Computed BEFORE the empty-window early return because it is
  // window-independent: it looks at the caller's 10 most-recent COMPLETED games
  // overall (not the selected window), so a user with no games in the current
  // window can still be eligible (e.g. the fixed-24h /watch profile, or a 24h
  // /stats request after an idle day). Chaos games are flagged by a top-level
  // `chaosMode` key in the gameState JSONB; a win is the game's `winner`
  // matching the caller's slot name (same convention as the Shark win count).
  // The Chaos `none` variant and ties store `winner = null`, so they correctly
  // never trigger it.
  const recentRows = await db
    .select({
      winner: gamesTable.winner,
      displayName: gameParticipantsTable.displayName,
      chaosMode: sql<string | null>`${gamesTable.gameState} ->> 'chaosMode'`,
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

  if (rows.length === 0) return core;
  core.gamesPlayed = rows.length;

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

  for (const r of rows) {
    const part = partByGame.get(r.id);
    const displayName = part?.displayName ?? "";
    const startMs = part?.statsStartAt ? part.statsStartAt.getTime() : -Infinity;
    const leftMs = part?.leftAt ? part.leftAt.getTime() : Infinity;
    const { shotLog, players, undoCount, isShark } = parseGameState(r.gameState);

    // The caller's own shots within their participation window.
    const mine = shotLog.filter(
      (e) =>
        e.playerName === displayName &&
        typeof e.timestamp === "number" &&
        e.timestamp >= startMs &&
        e.timestamp <= leftMs,
    );

    // Pace (recomputed — no per-participant BPM column).
    const bpm = playerBpm(mine);
    if (bpm != null) bpms.push(bpm);

    // Accuracy (aggregate ratio + per-game best).
    const { made, attempts } = accuracyCounts(mine);
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

    // Event counts (own shots only).
    for (const e of mine) {
      if (isShot(e)) core.totalShots += 1;
      if (e.type === "miss") core.totalMisses += 1;
      if (e.type === "foul" || e.isFoul === true) core.totalFouls += 1;
      if (e.type === "safety") core.totalSafeties += 1;
      // Top balls — pockets only (sink / terminal win), not lose.
      if (typeof e.ball === "number" && (e.type === "sink" || e.type === "win")) {
        ballCounts.set(e.ball, (ballCounts.get(e.ball) ?? 0) + 1);
      }
    }
    core.totalUndos += undoCount;

    // Play time grouped by type (whole-game duration).
    const agg = byType.get(r.gameType) ?? { total: 0, count: 0 };
    agg.total += r.durationMs;
    agg.count += 1;
    byType.set(r.gameType, agg);

    // Win/Loss — non-practice only.
    if (r.gameType !== "practice") {
      nonPracticeGames += 1;
      if (r.winner != null && r.winner === displayName) wins += 1;
    }

    // 8-ball decided-on-the-8 (own attempts only).
    if (r.gameType === "8ball") {
      const t = eightBallTerminal(mine, displayName);
      if (t.decided) {
        eightDecided += 1;
        if (t.clean) eightClean += 1;
      }
      // Solids vs stripes — only when a group was locked in for this player.
      const me = players.find((p) => p.name === displayName);
      if (me?.team === "solids") core.solidsCount += 1;
      else if (me?.team === "stripes") core.stripesCount += 1;
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
  core.avgShotsPerGame = round1(core.totalShots / core.gamesPlayed);
  core.avgMissesPerGame = round1(core.totalMisses / core.gamesPlayed);
  core.avgFoulsPerGame = round1(core.totalFouls / core.gamesPlayed);
  core.avgSafetiesPerGame = round1(core.totalSafeties / core.gamesPlayed);
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
  // (window-independent, unlike sharkGames above). Shark games are flagged by a
  // top-level `sharkAggression` key in the gameState JSONB; a win is the game's
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
        sql`${gamesTable.gameState} ->> 'sharkAggression' IS NOT NULL`,
        sql`${gamesTable.winner} = ${gameParticipantsTable.displayName}`,
        sql`${gamesTable.winner} <> ${SHARK_PLAYER_NAME}`,
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
): Promise<{ core: StatsCore; cached: boolean }> {
  const key = scope === "global" ? `global:${window}` : `personal:${userId}:${window}`;
  const now = Date.now();
  if (!refresh) {
    const hit = statsCache.get(key);
    if (hit && hit.expiresAt > now) return { core: hit.core, cached: true };
  }
  const core =
    scope === "global"
      ? await computeGlobalStats(window)
      : await computePersonalStats(userId as string, window);
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

export interface LeaderboardRow {
  rank: number;
  screenName: string;
  bpm: number;
  accuracy: number | null;
  gamesPlayed: number;
  // All-time completed Shark-mode game count (window-independent), mirroring
  // the profile `sharkLevel`. 0 when the player has no Shark games.
  sharkLevel: number;
}

/** Defensive cap on eligible game rows parsed in one ranking pass (cached). */
const LEADERBOARD_MAX_ROWS = 20000;
/** Minimum qualifying games before a player is ranked at all. */
const LEADERBOARD_MIN_GAMES = 3;
/** Number of a player's best games averaged into their score. */
const LEADERBOARD_BEST_N = 3;
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

async function computeLeaderboard(window: LeaderboardWindow): Promise<LeaderboardRow[]> {
  const cutoff = leaderboardCutoff(window);
  const conds = [
    isNotNull(gamesTable.endedAt),
    eq(gamesTable.gameType, "8ball"),
    eq(gamesTable.maxPlayers, 2),
    sql`(${gamesTable.gameState} ->> 'ruleSet' = 'open-through-break' OR (${gamesTable.gameState} ->> 'ruleSet' IS NULL AND ${gamesTable.endedAt} < ${LEADERBOARD_NULL_RULESET_CUTOFF}))`,
    sql`${gamesTable.gameState} ->> 'sharkAggression' IS NULL`,
    sql`${gamesTable.gameState} ->> 'chaosMode' IS NULL`,
  ];
  if (cutoff) conds.push(gte(gamesTable.endedAt, cutoff));

  const rows = await db
    .select({ id: gamesTable.id, gameState: gamesTable.gameState })
    .from(gamesTable)
    .where(and(...conds))
    .orderBy(desc(gamesTable.endedAt))
    .limit(LEADERBOARD_MAX_ROWS);
  if (rows.length === 0) return [];

  const gameIds = rows.map((r) => r.id);
  // Only registered participants count — guests (userId null) are skipped via
  // the inner join. screenName is the canonical name (also the /watch key),
  // not the per-game displayName, so a renamed player stays one entry.
  const parts = await db
    .select({
      gameId: gameParticipantsTable.gameId,
      userId: gameParticipantsTable.userId,
      displayName: gameParticipantsTable.displayName,
      statsStartAt: gameParticipantsTable.statsStartAt,
      leftAt: gameParticipantsTable.leftAt,
      screenName: usersTable.screenName,
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

  // Per-user accumulation of qualifying per-game {bpm, accuracy}. Keyed by
  // userId so the same player across renames stays one entry.
  const byUser = new Map<
    string,
    { screenName: string; games: Array<{ bpm: number; accuracy: number | null }> }
  >();

  for (const r of rows) {
    const ps = partsByGame.get(r.id);
    if (!ps) continue;
    const { shotLog } = parseGameState(r.gameState);
    for (const p of ps) {
      if (!p.userId) continue;
      const startMs = p.statsStartAt ? p.statsStartAt.getTime() : -Infinity;
      const leftMs = p.leftAt ? p.leftAt.getTime() : Infinity;
      const mine = shotLog.filter(
        (e) =>
          e.playerName === p.displayName &&
          typeof e.timestamp === "number" &&
          e.timestamp >= startMs &&
          e.timestamp <= leftMs,
      );
      const bpm = playerBpm(mine);
      // Drop games with no usable pace or an implausible (outlier) one.
      if (bpm == null || bpm <= 0 || bpm > LEADERBOARD_MAX_PLAUSIBLE_BPM) continue;
      const { made, attempts } = accuracyCounts(mine);
      const accuracy = attempts > 0 ? Math.round((made / attempts) * 100) : null;
      const entry = byUser.get(p.userId) ?? { screenName: p.screenName, games: [] };
      entry.games.push({ bpm, accuracy });
      byUser.set(p.userId, entry);
    }
  }

  // Qualifying players (>= min games), keeping userId so we can attach each
  // one's all-time Shark-mode count below.
  const ranked: Array<{
    userId: string;
    screenName: string;
    bpm: number;
    accuracy: number | null;
    gamesPlayed: number;
  }> = [];
  for (const [userId, entry] of byUser.entries()) {
    if (entry.games.length < LEADERBOARD_MIN_GAMES) continue;
    const best = [...entry.games].sort((a, b) => b.bpm - a.bpm).slice(0, LEADERBOARD_BEST_N);
    const avgBpm = round1(best.reduce((s, g) => s + g.bpm, 0) / best.length);
    const accs = best.map((g) => g.accuracy).filter((a): a is number => a != null);
    const accuracy = accs.length > 0 ? Math.round(accs.reduce((s, a) => s + a, 0) / accs.length) : null;
    ranked.push({ userId, screenName: entry.screenName, bpm: avgBpm, accuracy, gamesPlayed: entry.games.length });
  }

  // All-time Shark-mode WIN count per ranked user (window-independent),
  // matching how the profile derives `sharkLevel` — only games the user beat
  // the Shark in, not every Shark game played. Shark games are solo and flagged
  // by a top-level `sharkAggression` key in the gameState JSONB; a win is the
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
          sql`${gamesTable.gameState} ->> 'sharkAggression' IS NOT NULL`,
          sql`${gamesTable.winner} = ${gameParticipantsTable.displayName}`,
          sql`${gamesTable.winner} <> ${SHARK_PLAYER_NAME}`,
        ),
      )
      .groupBy(gameParticipantsTable.userId);
    for (const sc of sharkCounts) {
      if (sc.userId) sharkByUser.set(sc.userId, Number(sc.c));
    }
  }

  const result: LeaderboardRow[] = ranked.map((r) => ({
    rank: 0,
    screenName: r.screenName,
    bpm: r.bpm,
    accuracy: r.accuracy,
    gamesPlayed: r.gamesPlayed,
    sharkLevel: sharkByUser.get(r.userId) ?? 0,
  }));
  // Rank by score (bpm) desc; tie-break by accuracy desc then name for stability.
  result.sort(
    (a, b) =>
      b.bpm - a.bpm ||
      (b.accuracy ?? -1) - (a.accuracy ?? -1) ||
      a.screenName.localeCompare(b.screenName),
  );
  result.forEach((r, i) => {
    r.rank = i + 1;
  });
  return result;
}

interface LeaderboardCacheEntry {
  rows: LeaderboardRow[];
  expiresAt: number;
}
const leaderboardCache = new Map<string, LeaderboardCacheEntry>();

/**
 * Resolve the full ranking for a window, using the 1-hour cache. The route
 * paginates / slices the returned array; the whole ranking is computed once per
 * window so per-page and widget reads are cheap.
 */
export async function resolveLeaderboard(window: LeaderboardWindow): Promise<LeaderboardRow[]> {
  const key = `leaderboard:${window}`;
  const now = Date.now();
  const hit = leaderboardCache.get(key);
  if (hit && hit.expiresAt > now) return hit.rows;
  const rows = await computeLeaderboard(window);
  leaderboardCache.set(key, { rows, expiresAt: now + STATS_CACHE_TTL_MS });
  return rows;
}
