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
  if (!currentPlayer.team) {
    return remaining.filter(b => b !== EIGHT_BALL);
  }

  const myGroup = getPlayerGroup(currentPlayer);
  const myRemaining = remaining.filter(b => myGroup.includes(b));

  if (myRemaining.length === 0) {
    return remaining.filter(b => b === EIGHT_BALL);
  }

  return myRemaining;
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
      shotLog: [],
    };
  } catch {
    return null;
  }
}

export function getTeamLabel(team?: Team): string {
  if (!team) return '???';
  return team === 'solids' ? 'Solids (1-7)' : 'Stripes (9-15)';
}

export function ballLabel(n: number): string {
  return `(${n})`;
}
