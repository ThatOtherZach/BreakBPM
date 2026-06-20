import {
  GAME_SUMMARY_VERSION,
  type GameSummary,
  type ParticipantSummary,
} from "@workspace/db";

/**
 * Pure, side-effect-free distillation of a finished game's `gameState` into the
 * authoritative summaries persisted at finalize (`games.summary` +
 * `game_participants.summary`) and the denormalized discriminator columns.
 *
 * This is the SINGLE SOURCE OF TRUTH for the per-player BPM / accuracy / event
 * math that used to live inline in `stats.ts` and `routes/games.ts`. Those read
 * paths now import these helpers (and consume the stored summaries) instead of
 * re-deriving from the heavy `gameState.shotLog`. The math intentionally mirrors
 * `artifacts/breakbpm/src/lib/gameLogic.ts` (`calculatePlayerBPM`,
 * `playerAccuracyCounts`) — keep them in lockstep if the scoring rules change.
 *
 * Importing only the version constant + types from `@workspace/db` keeps this
 * module free of any DB connection so it stays unit-testable.
 */

export { GAME_SUMMARY_VERSION };
export type { GameSummary, ParticipantSummary };

const EIGHT_BALL = 8;

/** Minimal shot-log entry shape parsed out of the gameState JSONB. */
export interface ShotEntry {
  type?: string;
  playerName?: string;
  ball?: number;
  isFoul?: boolean;
  timestamp?: number;
}

export interface ParsedGameState {
  shotLog: ShotEntry[];
  players: Array<{ name?: string; team?: string }>;
  undoCount: number;
  isShark: boolean;
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function parseGameState(raw: unknown): ParsedGameState {
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
export function isPocket(e: ShotEntry): boolean {
  return typeof e.ball === "number";
}
/** True for any entry that counts as a "shot" (excludes the Shark-wins 'lose' marker). */
export function isShot(e: ShotEntry): boolean {
  return isPocket(e) || e.type === "miss" || e.type === "foul" || e.type === "safety" || e.isFoul === true;
}

/**
 * Per-player BPM over an ordered, already-player-filtered entry list. Mirrors
 * `calculatePlayerBPM`: anchored at the player's first pocket, measured to
 * their latest entry. Returns null with no pockets, 0 for sub-millisecond.
 */
export function playerBpm(entries: ShotEntry[]): number | null {
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
export function accuracyCounts(entries: ShotEntry[]): { made: number; attempts: number } {
  const made = entries.filter(isPocket).length;
  const attempts = entries.filter(
    (e) => isPocket(e) || e.type === "miss" || e.type === "foul" || e.isFoul === true,
  ).length;
  return { made, attempts };
}

/** Find this game's terminal 8-ball shot (if any), restricted to `player` when given. */
export function eightBallTerminal(
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

/** Encode a BPM (or null) as the ×10 integer the summaries store. */
function bpmX10(bpm: number | null): number | null {
  return bpm == null ? null : Math.round(bpm * 10);
}

/**
 * Per-participant input the builder needs to scope each slot's two windows.
 * Mirrors the `game_participants` columns the read paths join on today.
 */
export interface SummaryParticipantInput {
  slotIndex: number;
  displayName: string;
  statsStartAt: Date | null;
  leftAt: Date | null;
}

export interface BuiltSummary {
  game: GameSummary;
  /** Keyed by `slotIndex` → the participant summary to store on that row. */
  bySlot: Map<number, ParticipantSummary>;
}

/** Denormalized discriminator columns promoted out of gameState at finalize. */
export interface GameDiscriminators {
  sharkAggression: string | null;
  chaosMode: string | null;
  ruleSet: string | null;
  hostTheme: string | null;
  endReason: string | null;
}

/**
 * Extract the discriminator columns from a finished game's gameState. Each maps
 * EXACTLY to the legacy `gameState ->> 'x' IS NULL` SQL filter it replaces:
 *  - `sharkAggression` is non-null whenever the JSONB key is present & non-null
 *    (matching `parseGameState().isShark` and `->> IS NOT NULL`).
 *  - the rest are the raw string value or null (absent / non-string / JSON null).
 * `endReason` is the raw `forfeitReason` (INCLUDING "all_left"); the history
 * surface still narrows it to the two user-facing values.
 */
export function extractDiscriminators(rawGameState: unknown): GameDiscriminators {
  const gs = (rawGameState ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const shark = gs["sharkAggression"];
  return {
    sharkAggression: shark === undefined || shark === null ? null : String(shark),
    chaosMode: str(gs["chaosMode"]),
    ruleSet: str(gs["ruleSet"]),
    hostTheme: str(gs["hostTheme"]),
    endReason: str(gs["forfeitReason"]),
  };
}

/**
 * Distill a finished game's `gameState` + its participant rows into the
 * authoritative game-level and per-slot summaries. PURE — no DB access. The
 * caller persists `game` on `games.summary` and each `bySlot` value on the
 * matching `game_participants.summary`.
 *
 * Two per-participant windows are computed because the read paths use different
 * ones (collapsing them would regress a participant who left mid-game):
 *  - STATS  `[statsStartAt, leftAt]`, attributed by `displayName` (personal
 *    stats + leaderboard).
 *  - HISTORY `[statsStartAt, +inf)`, attributed by the slot's player name (the
 *    per-game history pace).
 */
export function buildGameSummary(
  rawGameState: unknown,
  participants: SummaryParticipantInput[],
): BuiltSummary {
  const gs = (rawGameState ?? {}) as Record<string, unknown>;
  const shotLog = Array.isArray(gs["shotLog"]) ? (gs["shotLog"] as ShotEntry[]) : [];
  const players = Array.isArray(gs["players"])
    ? (gs["players"] as Array<{ name?: string; team?: string }>)
    : [];
  const undoCount = typeof gs["undoCount"] === "number" ? (gs["undoCount"] as number) : 0;

  // ── Game-level (ALL players) ──
  let totalShots = 0;
  let totalMisses = 0;
  let totalFouls = 0;
  let totalSafeties = 0;
  const pocketSequence: Array<{ ball: number; player: string }> = [];
  for (const e of shotLog) {
    if (isShot(e)) totalShots += 1;
    if (e.type === "miss") totalMisses += 1;
    if (e.type === "foul" || e.isFoul === true) totalFouls += 1;
    if (e.type === "safety") totalSafeties += 1;
    // Pocket sequence: any entry that sank a ball (INCLUDES the terminal lose),
    // matching the legacy history mini-log.
    if (typeof e.ball === "number") {
      pocketSequence.push({ ball: e.ball, player: e.playerName ?? "" });
    }
  }
  const gameTerm = eightBallTerminal(shotLog, null);
  const game: GameSummary = {
    v: GAME_SUMMARY_VERSION,
    totalShots,
    totalMisses,
    totalFouls,
    totalSafeties,
    undoCount,
    eightDecided: gameTerm.decided,
    eightClean: gameTerm.clean,
    players: players.map((p) => ({ name: p.name ?? "", team: p.team ?? null })),
    pocketSequence,
  };

  // ── Per-participant ──
  const bySlot = new Map<number, ParticipantSummary>();
  for (const part of participants) {
    const startMs = part.statsStartAt ? part.statsStartAt.getTime() : -Infinity;
    const leftMs = part.leftAt ? part.leftAt.getTime() : Infinity;

    // STATS window [statsStartAt, leftAt], attributed by displayName.
    const statsMine = shotLog.filter(
      (e) =>
        e.playerName === part.displayName &&
        typeof e.timestamp === "number" &&
        (e.timestamp as number) >= startMs &&
        (e.timestamp as number) <= leftMs,
    );
    const statsBpm = playerBpm(statsMine);
    const { made, attempts } = accuracyCounts(statsMine);
    let shotCount = 0;
    let missCount = 0;
    let foulCount = 0;
    let safetyCount = 0;
    const ballCounts: Record<string, number> = {};
    for (const e of statsMine) {
      if (isShot(e)) shotCount += 1;
      if (e.type === "miss") missCount += 1;
      if (e.type === "foul" || e.isFoul === true) foulCount += 1;
      if (e.type === "safety") safetyCount += 1;
      // Top balls — pockets only (sink / terminal win), not lose.
      if (typeof e.ball === "number" && (e.type === "sink" || e.type === "win")) {
        const k = String(e.ball);
        ballCounts[k] = (ballCounts[k] ?? 0) + 1;
      }
    }
    const statsTerm = eightBallTerminal(statsMine, part.displayName);
    const team = players.find((p) => p.name === part.displayName)?.team ?? null;

    // HISTORY window [statsStartAt, +inf), attributed by the slot's player name.
    const slotName =
      typeof players[part.slotIndex]?.name === "string"
        ? (players[part.slotIndex].name as string)
        : null;
    const historyMine =
      slotName == null
        ? []
        : shotLog.filter(
            (e) =>
              e.playerName === slotName &&
              typeof e.timestamp === "number" &&
              (e.timestamp as number) >= startMs,
          );
    const historyBpm = playerBpm(historyMine);

    bySlot.set(part.slotIndex, {
      v: GAME_SUMMARY_VERSION,
      statsBpmX10: bpmX10(statsBpm),
      made,
      attempts,
      shotCount,
      missCount,
      foulCount,
      safetyCount,
      team,
      ballCounts,
      eightDecided: statsTerm.decided,
      eightClean: statsTerm.clean,
      historyBpmX10: bpmX10(historyBpm),
      historySunk: historyMine.filter(isPocket).length,
      historyShots: historyMine.length,
    });
  }

  return { game, bySlot };
}

/**
 * Read a stored `games.summary` blob, returning it only when the version
 * matches the current one. Empty `{}` (pre-finalize / un-backfilled) or a stale
 * version → null, so callers fall back / skip ("absent not corrupt").
 */
export function readGameSummary(raw: unknown): GameSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<GameSummary>;
  return s.v === GAME_SUMMARY_VERSION ? (s as GameSummary) : null;
}

/** As {@link readGameSummary}, for a `game_participants.summary` blob. */
export function readParticipantSummary(raw: unknown): ParticipantSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<ParticipantSummary>;
  return s.v === GAME_SUMMARY_VERSION ? (s as ParticipantSummary) : null;
}
