import { and, count, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db, gamesTable, gameParticipantsTable } from "@workspace/db";

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
  // Aligned per-game trend pairs (newest-first; sliced + reversed at the end).
  const trend: Array<{ bpm: number | null; accuracy: number | null }> = [];
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
    if (gameBpm != null || gameAccuracy != null) trend.push({ bpm: gameBpm, accuracy: gameAccuracy });
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
  // trend is collected newest-first (desc endedAt); take the most recent N and
  // reverse so the chart reads oldest→newest left-to-right.
  core.trend = trend.slice(0, TREND_MAX).reverse();
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
    })
    .from(gamesTable)
    .where(and(...conds))
    .orderBy(desc(gamesTable.endedAt))
    .limit(MAX_ROWS)) as Array<RowLike & { id: string }>;

  if (rows.length === 0) return core;
  core.gamesPlayed = rows.length;

  const byType = new Map<string, { total: number; count: number }>();
  const bpms: number[] = [];
  const accs: number[] = [];
  // Aligned per-game trend pairs (newest-first; sliced + reversed at the end).
  const trend: Array<{ bpm: number | null; accuracy: number | null }> = [];
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
    if (bpm != null || gameAccuracy != null) trend.push({ bpm, accuracy: gameAccuracy });

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
  // trend is collected newest-first (desc endedAt); take the most recent N and
  // reverse so the chart reads oldest→newest left-to-right.
  core.trend = trend.slice(0, TREND_MAX).reverse();
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

  // Shark Level is the user's ALL-TIME count of completed Shark-mode games
  // (window-independent, unlike sharkGames above). Shark games are flagged by a
  // top-level `sharkAggression` key in the gameState JSONB; count them in SQL
  // across every game the caller participated in, regardless of the window.
  const sharkRows = await db
    .select({ c: count() })
    .from(gamesTable)
    .where(
      and(
        inArray(gamesTable.id, ids),
        isNotNull(gamesTable.endedAt),
        sql`${gamesTable.gameState} ->> 'sharkAggression' IS NOT NULL`,
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
