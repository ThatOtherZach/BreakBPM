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
}

/** True when this is the solo-vs-Shark flavor of 8-ball. */
export function isSharkGame(state: Pick<GameState, 'gameType' | 'players' | 'sharkAggression'>): boolean {
  return state.gameType === '8ball' && state.players.length === 1 && state.sharkAggression !== undefined;
}

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
  // Shark mode (8-ball solo): all 15 balls are legal the entire game, like
  // practice. No solids/stripes assignment ever happens.
  if (gameType === '8ball' && players.length === 1) {
    return remaining;
  }
  // The 8-ball is always a legal tap until it's sunk — the game logic handles
  // the consequence (loss or win) based on context. Never lock it out in the UI.
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
      // Shark mode: sinking the 8 ends the game. Win/lose verdict is decided
      // in GameScreen based on Balls-Per-Shot (>1 = beat the Shark). Here we
      // just signal that the game is over.
      if (players.length === 1) {
        return { win: true, lose: false, message: '', switchTurn: false };
      }

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
  // Shark mode (solo 8-ball): no solids/stripes — all balls are legal the entire game.
  if (players.length === 1) return false;
  if (teamAssigned) return false;
  if (ballSunk === EIGHT_BALL) return false;
  return true;
}

/**
 * Shark steals a random remaining non-8 ball after a player miss/foul,
 * per the current aggression setting:
 *   - 'normal' → steal only on 'miss'
 *   - 'hard'   → steal on 'miss' or 'foul'
 *
 * The stolen ball is appended to BOTH `sharkSunkBalls` (Shark's score)
 * and `sunkBalls` (so the ball selector grays it out and the rack stays
 * consistent). A shot-log entry is added so History shows what happened.
 *
 * Special case: if the only ball left on the table is the 8, the Shark
 * wins the game outright instead of stealing — the player can no longer
 * recover.
 *
 * Returns the state unchanged if the aggression setting blocks this
 * event type, or if nothing is available to steal.
 */
export function applySharkMiss(
  state: GameState,
  eventType: 'miss' | 'foul',
): GameState {
  if (!isSharkGame(state)) return state;
  const allowed = state.sharkAggression === 'hard' || eventType === 'miss';
  if (!allowed) return state;

  const remaining = getRemainingBalls(state.sunkBalls, '8ball');
  const sharkSunk = state.sharkSunkBalls ?? [];
  const candidates = remaining.filter(b => b !== EIGHT_BALL && !sharkSunk.includes(b));

  const now = Date.now();
  const gameTime = now - state.gameStartTime;

  // Only the 8 remains and the player just missed/fouled → Shark wins.
  if (candidates.length === 0 && remaining.includes(EIGHT_BALL)) {
    const reason = eventType === 'foul' ? 'fouled on the 8-ball' : 'missed the 8-ball';
    const entry: ShotLogEntry = {
      type: 'lose',
      playerName: state.players[0]?.name ?? 'Player',
      timestamp: now,
      gameTime,
      note: `Shark wins — ${reason}`,
    };
    return {
      ...state,
      phase: 'ended',
      winner: '🦈 Shark',
      winMessage: `Shark wins — you ${reason}.`,
      lastActionTime: now,
      shotLog: [...state.shotLog, entry],
    };
  }

  if (candidates.length === 0) return state;

  const stolen = candidates[Math.floor(Math.random() * candidates.length)];
  const sharkEntry: ShotLogEntry = {
    type: 'sink',
    playerName: '🦈 Shark',
    ball: stolen,
    timestamp: now,
    gameTime,
    note: `Shark steals ball ${stolen}`,
  };

  return {
    ...state,
    sunkBalls: [...state.sunkBalls, stolen],
    sharkSunkBalls: [...sharkSunk, stolen],
    lastActionTime: now,
    shotLog: [...state.shotLog, sharkEntry],
  };
}

export function assignTeams(
  players: Player[],
  currentPlayerIndex: number,
  ballSunk: number
): Player[] {
  const updated = players.map(p => ({ ...p }));
  const isStripe = STRIPES.includes(ballSunk);
  updated[currentPlayerIndex].team = isStripe ? 'stripes' : 'solids';

  if (players.length === 2) {
    const opponentIndex = currentPlayerIndex === 0 ? 1 : 0;
    updated[opponentIndex].team = isStripe ? 'solids' : 'stripes';
  }

  return updated;
}

export function generateShareCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
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
      lat: state.lastActionTime,
      w: state.winner,
      wm: state.winMessage,
      sc: state.shareCode,
      ta: state.teamAssigned,
      sl: state.shotLog,
      ga: state.sharkAggression,
      gsb: state.sharkSunkBalls,
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
      lastActionTime: d.lat ?? null,
      winner: d.w,
      winMessage: d.wm,
      shareCode: d.sc,
      teamAssigned: d.ta,
      shotLog: Array.isArray(d.sl) ? d.sl : [],
      sharkAggression: d.ga,
      sharkSunkBalls: Array.isArray(d.gsb) ? d.gsb : undefined,
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
