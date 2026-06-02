export type GameType = '8ball' | '9ball' | 'practice';
export type Team = 'solids' | 'stripes';
export type ShotType = 'sink' | 'foul' | 'safety' | 'miss' | 'win' | 'lose';

export interface Player {
  id: number;
  name: string;
  team?: Team;
}

export interface ShotLogEntry {
  type: ShotType;
  playerName: string;
  ball?: number;
  timestamp: number;
  gameTime: number;
  note?: string;
  /**
   * True when this entry is a foul the player personally committed, even when
   * it's terminal and therefore logged as 'lose' (a foul on the 8-ball). Lets
   * accuracy count it as a shot attempt, while the separate Shark-wins 'lose'
   * marker (not a shot the human took) stays unflagged and excluded.
   */
  isFoul?: boolean;
  /**
   * Per-player BPM snapshot at the moment this pocket happened. Only set on
   * pocketing entries (sink / terminal win / terminal lose that pocketed a
   * ball). Missing on miss/foul/safety and on Shark steals.
   */
  bpm?: number;
}

export type SharkAggression = 'normal' | 'hard';

export interface GameState {
  phase: 'setup' | 'playing' | 'ended';
  gameType: GameType;
  players: Player[];
  currentPlayerIndex: number;
  sunkBalls: number[];
  shotLog: ShotLogEntry[];
  gameStartTime: number;
  /** Timestamp of the very first action (sink/miss/foul/safety). BPM is measured from here. */
  firstActionTime: number | null;
  /**
   * Pace clock anchor. Set the first time ANY ball is pocketed (sink, or a
   * terminal win/lose entry that also pockets a ball). Null until then so
   * the HUD shows 00:00 through the break, racking, and any pre-pocket
   * misses/fouls/safeties. The visible elapsed clock and the saved
   * durationMs are measured from here.
   */
  timerStartTime: number | null;
  /** Last action timestamp — used for the final BPM snapshot at game end. */
  lastActionTime: number | null;
  winner: string | null;
  winMessage: string;
  shareCode: string;
  teamAssigned: boolean;
  /**
   * Shark mode (8-ball + 1 player). Presence of `sharkAggression` is the
   * canonical signal that this is a shark game; `sharkSunkBalls` tracks
   * which balls the invisible opponent has stolen.
   */
  sharkAggression?: SharkAggression;
  sharkSunkBalls?: number[];
  /**
   * Shark mode: a miss/foul has triggered a Shark sink and the UI is waiting
   * for the player to tap which ball came off the table. Blocks normal play
   * until resolved via resolveSharkPick().
   */
  pendingSharkPick?: boolean;
}

/** True when this is the solo-vs-Shark flavor of 8-ball. */
export function isSharkGame(state: Pick<GameState, 'gameType' | 'players' | 'sharkAggression'>): boolean {
  return state.gameType === '8ball' && state.players.length === 1 && state.sharkAggression !== undefined;
}

/**
 * Canonical identity string for the invisible Shark opponent. Used as
 * `playerName` on Shark shot-log entries and as the `winner` value when
 * the Shark wins. The visual is rendered separately via <SharkIcon />.
 */
export const SHARK_PLAYER_NAME = 'Shark';

export const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
export const STRIPES = [9, 10, 11, 12, 13, 14, 15];
export const EIGHT_BALL = 8;
export const ALL_8BALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
export const ALL_9BALL = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function getRemainingBalls(sunkBalls: number[], gameType: GameType): number[] {
  const all = gameType === '9ball' ? ALL_9BALL : ALL_8BALL;
  return all.filter(b => !sunkBalls.includes(b));
}

export function getPlayerGroup(player: Player): number[] {
  if (!player.team) return [];
  return player.team === 'solids' ? SOLIDS : STRIPES;
}

export function getLegalBalls(
  gameType: GameType,
  players: Player[],
  currentPlayerIndex: number,
  sunkBalls: number[]
): number[] {
  const currentPlayer = players[currentPlayerIndex];
  const remaining = getRemainingBalls(sunkBalls, gameType);

  if (gameType === 'practice') return remaining;

  if (gameType === '9ball') {
    return remaining;
  }

  // 8-ball
  // The 8-ball is always a legal tap until it's sunk — the game logic handles
  // the consequence (loss or win) based on context. Never lock it out in the UI.
  // Shark mode (solo) starts open: any non-8 ball is legal until the first
  // player sink locks in a team, then this falls through to the assigned-team
  // logic below.
  if (!currentPlayer.team) {
    return remaining; // no group assigned yet — all balls reachable
  }

  const myGroup = getPlayerGroup(currentPlayer);
  const myRemaining = remaining.filter(b => myGroup.includes(b));

  if (myRemaining.length === 0) {
    // Group cleared — 8-ball is the only legal shot
    return remaining.filter(b => b === EIGHT_BALL);
  }

  // Group not yet cleared — own balls + 8 are both tappable
  return [...myRemaining, EIGHT_BALL].filter(b => remaining.includes(b));
}

export function getLowestBall(sunkBalls: number[]): number {
  const remaining = ALL_9BALL.filter(b => !sunkBalls.includes(b));
  return remaining.length > 0 ? remaining[0] : 0;
}

export function checkSinkResult(
  gameType: GameType,
  players: Player[],
  currentPlayerIndex: number,
  sunkBalls: number[],
  ballSunk: number
): { win: boolean; lose: boolean; message: string; switchTurn: boolean } {
  const currentPlayer = players[currentPlayerIndex];

  if (gameType === '9ball') {
    if (ballSunk === 9) {
      return { win: true, lose: false, message: `${currentPlayer.name} sinks the 9-ball! WINNER!`, switchTurn: false };
    }
    return { win: false, lose: false, message: '', switchTurn: false };
  }

  if (gameType === '8ball') {
    const newSunk = [...sunkBalls, ballSunk];

    if (ballSunk === EIGHT_BALL) {
      // Shark mode follows the same end-condition rules as 2-player 8-ball:
      // Golden Break wins, early 8 loses, group-cleared + 8 wins. BPS is only
      // a displayed stat in GameScreen, never the deciding factor.

      // Golden Break: 8-ball sunk as the very first ball on the break → instant win
      if (sunkBalls.length === 0) {
        return { win: true, lose: false, message: `GOLDEN BREAK! ${currentPlayer.name} sinks the 8 on the break — WINNER!`, switchTurn: false };
      }

      // No team assigned yet (sank 8 before establishing a group) → loss
      if (!currentPlayer.team) {
        return { win: false, lose: true, message: `${currentPlayer.name} pocketed the 8-ball early — LOSS!`, switchTurn: false };
      }

      const myGroup = getPlayerGroup(currentPlayer);
      const myRemaining = myGroup.filter(b => !newSunk.includes(b));
      if (myRemaining.length === 0) {
        return { win: true, lose: false, message: `${currentPlayer.name} sinks the 8-ball — WINNER!`, switchTurn: false };
      } else {
        return { win: false, lose: true, message: `${currentPlayer.name} pocketed the 8-ball too early — LOSS!`, switchTurn: false };
      }
    }
    return { win: false, lose: false, message: '', switchTurn: false };
  }

  return { win: false, lose: false, message: '', switchTurn: false };
}

export function shouldAssignTeams(
  gameType: GameType,
  teamAssigned: boolean,
  players: Player[],
  currentPlayerIndex: number,
  ballSunk: number
): boolean {
  if (gameType !== '8ball') return false;
  if (teamAssigned) return false;
  if (ballSunk === EIGHT_BALL) return false;
  return true;
}

/**
 * In Shark Mode, returns the set of balls the Shark is allowed to take when
 * the player misses/fouls. Before team assignment the table is open (any
 * remaining non-8 ball, minus any the Shark already has). Once teams are
 * locked in, the Shark may only take from its own group — the player's
 * group is safe from steals.
 */
export function getSharkPickCandidates(state: GameState): number[] {
  const remaining = getRemainingBalls(state.sunkBalls, '8ball');
  const sharkSunk = state.sharkSunkBalls ?? [];
  let candidates = remaining.filter(b => b !== EIGHT_BALL && !sharkSunk.includes(b));
  const player = state.players[0];
  if (state.teamAssigned && player?.team) {
    const sharkGroup = player.team === 'solids' ? STRIPES : SOLIDS;
    candidates = candidates.filter(b => sharkGroup.includes(b));
  }
  return candidates;
}

/** Resolves a pending Shark sink: the chosen ball goes to the Shark's pile. */
export function resolveSharkPick(state: GameState, ball: number): GameState {
  const now = Date.now();
  const sharkSunk = state.sharkSunkBalls ?? [];
  // Pocketing event → starts the pace clock if it hasn't started yet.
  const timerStartTime = state.timerStartTime ?? now;
  const entry: ShotLogEntry = {
    type: 'sink',
    playerName: SHARK_PLAYER_NAME,
    ball,
    timestamp: now,
    gameTime: now - timerStartTime,
    note: `Shark sinks ball ${ball}`,
  };
  return {
    ...state,
    timerStartTime,
    sunkBalls: [...state.sunkBalls, ball],
    sharkSunkBalls: [...sharkSunk, ball],
    pendingSharkPick: false,
    lastActionTime: now,
    shotLog: [...state.shotLog, entry],
  };
}

/**
 * Marks a Shark sink as pending after a player miss/foul, per the current
 * aggression setting:
 *   - 'normal' → trigger on 'foul' only
 *   - 'hard'   → trigger on 'miss' or 'foul'
 *
 * Sets `pendingSharkPick = true` so the UI can prompt the player to tap
 * the ball they removed from the table. Use `resolveSharkPick()` once the
 * player makes a selection.
 *
 * Special case: if the Shark has no legal non-8 ball left to take but the
 * 8-ball is still on the table, its only legal target is the 8 — it takes it
 * and wins outright (player cannot recover), no pick is needed. This covers
 * both "only the 8 left on the whole table" and "Shark has cleared its own
 * group while the player still has balls".
 *
 * Returns the state unchanged if the aggression setting blocks this
 * event type, or if the Shark has nothing legal to take.
 */
export function applySharkMiss(
  state: GameState,
  eventType: 'miss' | 'foul',
): GameState {
  if (!isSharkGame(state)) return state;
  const allowed = state.sharkAggression === 'hard' || eventType === 'foul';
  if (!allowed) return state;

  const remaining = getRemainingBalls(state.sunkBalls, '8ball');
  const candidates = getSharkPickCandidates(state);

  // The Shark has no non-8 ball left to take but the 8 is still on the table →
  // its only legal target is the 8. It takes it and wins; the player can't
  // recover. Covers both "only the 8 left overall" and "Shark cleared its own
  // group" (the player may still have balls on the table).
  if (candidates.length === 0 && remaining.includes(EIGHT_BALL)) {
    const now = Date.now();
    const onlyEightLeft = remaining.length === 1;
    const verb = eventType === 'foul' ? 'fouled' : 'missed';
    const reason = onlyEightLeft
      ? `${verb} ${eventType === 'foul' ? 'on ' : ''}the 8-ball`
      : `${verb} and the Shark sank the 8-ball`;
    const entry: ShotLogEntry = {
      type: 'lose',
      playerName: state.players[0]?.name ?? 'Player',
      timestamp: now,
      gameTime: state.timerStartTime != null ? now - state.timerStartTime : 0,
      note: `Shark wins — ${reason}`,
    };
    return {
      ...state,
      phase: 'ended',
      winner: SHARK_PLAYER_NAME,
      winMessage: `Shark wins — you ${reason}.`,
      lastActionTime: now,
      shotLog: [...state.shotLog, entry],
    };
  }

  if (candidates.length === 0) return state;

  return { ...state, pendingSharkPick: true };
}

export function assignTeams(
  players: Player[],
  currentPlayerIndex: number,
  ballSunk: number
): Player[] {
  const updated = players.map(p => ({ ...p }));
  const isStripe = STRIPES.includes(ballSunk);
  const sinkerTeam: Team = isStripe ? 'stripes' : 'solids';
  const opposingTeam: Team = isStripe ? 'solids' : 'stripes';
  updated[currentPlayerIndex].team = sinkerTeam;

  if (players.length === 2) {
    const opponentIndex = currentPlayerIndex === 0 ? 1 : 0;
    updated[opponentIndex].team = opposingTeam;
  } else if (players.length === 4) {
    // Doubles: standard pool seating — seats 0+2 vs 1+3 (alternating turn
    // order). The sinker's partner inherits the sinker's group; the other
    // pair gets the opposite group.
    const partnerIndex = (currentPlayerIndex + 2) % 4;
    updated[partnerIndex].team = sinkerTeam;
    for (let i = 0; i < 4; i++) {
      if (i !== currentPlayerIndex && i !== partnerIndex) {
        updated[i].team = opposingTeam;
      }
    }
  }

  return updated;
}

/**
 * Local fallback generator — used when the server hasn't issued a code
 * yet (e.g. anonymous play). Server-issued codes (generated in
 * `artifacts/api-server/src/lib/shareCode.ts`) take precedence and are
 * guaranteed unique against active + recently-ended games.
 *
 * 32-char safe alphabet (no 0/1/I/O), 5 chars → 32^5 ≈ 33.5M codes.
 */
export const SHARE_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const SHARE_CODE_LENGTH = 5;

export function generateShareCode(): string {
  let code = '';
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) {
    code += SHARE_CODE_ALPHABET[Math.floor(Math.random() * SHARE_CODE_ALPHABET.length)];
  }
  return code;
}

/** Canonical form: uppercase, alphabet-only. Returns null if invalid. */
export function normalizeShareCode(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const up = raw.toUpperCase().trim();
  if (up.length !== SHARE_CODE_LENGTH) return null;
  for (let i = 0; i < up.length; i++) {
    if (!SHARE_CODE_ALPHABET.includes(up[i])) return null;
  }
  return up;
}

/**
 * Best-practice BPM: measure from the first action, not game start.
 * This way idle setup time doesn't dilute the score.
 * Pass a specific `atTime` to get a snapshot (e.g. at the moment an action happened).
 */
export function calculateBPM(
  sunkCount: number,
  firstActionTime: number | null,
  atTime: number = Date.now()
): number {
  if (!firstActionTime || sunkCount === 0) return 0;
  const elapsed = (atTime - firstActionTime) / 60000;
  if (elapsed < 0.001) return 0;
  return Math.round((sunkCount / elapsed) * 10) / 10;
}

/**
 * Per-player BPM: counts a player's pocketed balls (any shot-log entry
 * where they pocketed something — type 'sink', or the terminal 'win'/'lose'
 * entries that also pocket a ball), anchored from that player's very first
 * action, with the endpoint being their most recent log entry. Returns
 * null if the player hasn't done anything yet.
 *
 * Deriving both endpoints from the player's own entries means another
 * player's actions — and Shark steals (logged under SHARK_PLAYER_NAME) — never
 * inflate or extend the human's clock or sink count.
 */
export function calculatePlayerBPM(
  shotLog: ShotLogEntry[],
  playerName: string,
): number | null {
  const mine = shotLog.filter(e => e.playerName === playerName);
  if (mine.length === 0) return null;
  // A "pocketed" entry is any one where a ball was sunk. Terminal shots
  // (winning by pocketing the 8, scratching on the 8) are logged as
  // 'win'/'lose' but still pocket a ball — so we key off `ball !== undefined`
  // rather than the type alone. Misses, fouls, safeties, and the Shark's
  // foul-on-8 'lose' entry have no `ball` and are excluded.
  const sinks = mine.filter(e => e.ball !== undefined);
  if (sinks.length === 0) return null;
  const firstSinkAt = sinks[0].timestamp;
  const lastAt = mine[mine.length - 1].timestamp;
  const elapsed = (lastAt - firstSinkAt) / 60000;
  if (elapsed < 0.001) return 0;
  return Math.round((sinks.length / elapsed) * 10) / 10;
}

/**
 * Per-player accuracy counts. `made` is the number of balls the player
 * pocketed; `attempts` is the number of qualifying shots that count toward
 * accuracy. A qualifying shot is any pocketed ball plus misses and fouls
 * (including a foul on the 8-ball, flagged via `isFoul`). Safeties are
 * intentional defensive plays and are excluded, as is the Shark-wins 'lose'
 * marker. Shark steals are logged under the Shark's name and so never enter
 * a human player's counts.
 */
export function playerAccuracyCounts(
  shotLog: ShotLogEntry[],
  playerName: string,
): { made: number; attempts: number } {
  const mine = shotLog.filter(e => e.playerName === playerName);
  // A "made" ball is any entry where a ball was pocketed (sink, or a
  // terminal win/lose that pocketed a ball) — keyed off `ball !== undefined`,
  // mirroring calculatePlayerBPM's numerator.
  const made = mine.filter(e => e.ball !== undefined).length;
  const attempts = mine.filter(
    e => e.ball !== undefined || e.type === 'miss' || e.type === 'foul' || e.isFoul === true,
  ).length;
  return { made, attempts };
}

/**
 * Per-player shooting accuracy as a whole-number percentage (0–100), or
 * `null` when the player has taken no qualifying shots yet. Accuracy is
 * pocketed balls divided by qualifying shots; see `playerAccuracyCounts`
 * for what counts.
 */
export function calculatePlayerAccuracy(
  shotLog: ShotLogEntry[],
  playerName: string,
): number | null {
  const { made, attempts } = playerAccuracyCounts(shotLog, playerName);
  if (attempts === 0) return null;
  return Math.round((made / attempts) * 100);
}

export function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function encodeGameState(state: GameState): string {
  try {
    const compact = {
      p: state.phase,
      gt: state.gameType,
      pl: state.players.map(p => ({ id: p.id, n: p.name, t: p.team })),
      ci: state.currentPlayerIndex,
      sb: state.sunkBalls,
      gst: state.gameStartTime,
      fat: state.firstActionTime,
      tst: state.timerStartTime,
      lat: state.lastActionTime,
      w: state.winner,
      wm: state.winMessage,
      sc: state.shareCode,
      ta: state.teamAssigned,
      sl: state.shotLog,
      ga: state.sharkAggression,
      gsb: state.sharkSunkBalls,
      psp: state.pendingSharkPick,
    };
    return btoa(JSON.stringify(compact));
  } catch {
    return '';
  }
}

export function decodeGameState(encoded: string): Partial<GameState> | null {
  try {
    const d = JSON.parse(atob(encoded));
    return {
      phase: d.p,
      gameType: d.gt,
      players: d.pl.map((p: { id: number; n: string; t?: Team }) => ({ id: p.id, name: p.n, team: p.t })),
      currentPlayerIndex: d.ci,
      sunkBalls: d.sb,
      gameStartTime: d.gst,
      firstActionTime: d.fat ?? null,
      timerStartTime: d.tst ?? null,
      lastActionTime: d.lat ?? null,
      winner: d.w,
      winMessage: d.wm,
      shareCode: d.sc,
      teamAssigned: d.ta,
      shotLog: Array.isArray(d.sl) ? d.sl : [],
      sharkAggression: d.ga,
      sharkSunkBalls: Array.isArray(d.gsb) ? d.gsb : undefined,
      pendingSharkPick: d.psp ?? false,
    };
  } catch {
    return null;
  }
}

/**
 * Local persistence of an in-progress game. Source of truth for refresh /
 * tab-close recovery. Holds the full GameState plus the server-issued
 * gameId (so /games/activity and /games/save continue updating the same
 * row across refreshes) and the wall-clock cap for anonymous play.
 *
 * Cleared whenever the game ends, the user starts a new one, or an
 * explicit abandon happens.
 */
const INPROGRESS_KEY = 'breakbpm:inprogress:v1';

export interface PersistedInProgressGame {
  state: GameState;
  serverGameId: string | null;
  maxGameDurationMs: number | null;
  pausedDuration: number;
  savedAt: number;
}

export function saveInProgressGame(p: PersistedInProgressGame): void {
  try {
    localStorage.setItem(INPROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* quota / private mode — best-effort only */
  }
}

export function loadInProgressGame(): PersistedInProgressGame | null {
  try {
    const raw = localStorage.getItem(INPROGRESS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PersistedInProgressGame;
    if (!p || !p.state || p.state.phase !== 'playing') return null;
    if (!Array.isArray(p.state.players) || p.state.players.length === 0) return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * Migration helper: older snapshots (localStorage, server-resume rows,
 * legacy ?state= share links) used '🦈 Shark' as the canonical Shark
 * identity. Rewrites in place to SHARK_PLAYER_NAME so downstream filters
 * (per-player BPM, BPS counters, winner-icon checks) keep matching.
 * Safe to call on partial states.
 */
export function normalizeSharkIdentity<T extends Partial<GameState>>(s: T): T {
  const LEGACY = '🦈 Shark';
  if (s.winner === LEGACY) s.winner = SHARK_PLAYER_NAME;
  if (Array.isArray(s.shotLog)) {
    for (const e of s.shotLog) {
      if (e && e.playerName === LEGACY) e.playerName = SHARK_PLAYER_NAME;
    }
  }
  return s;
}

export function clearInProgressGame(): void {
  try {
    localStorage.removeItem(INPROGRESS_KEY);
  } catch {
    /* noop */
  }
}

export function getTeamLabel(team?: Team): string {
  if (!team) return '???';
  return team === 'solids' ? 'Solids (1-7)' : 'Stripes (9-15)';
}

export function ballLabel(n: number): string {
  return `(${n})`;
}
