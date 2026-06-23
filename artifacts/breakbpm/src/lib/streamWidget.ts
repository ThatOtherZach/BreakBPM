// Shared, presentational view-model for the ONE reusable Windows-98 styled
// HUD/result widget (<StreamWidget>). The same widget is used on two surfaces:
//   1. the end-game "Share" action (snapshotted to a PNG via streamWidgetImage)
//   2. the live OBS overlay at /watch/:name?obs=1
// so both render from the identical data shape produced here. This module is
// PURE (no React, no hooks, no DOM) so either caller can build the data from
// whatever game-state it holds (GameScreen's local GameState, or the spectator
// snapshot in JoinedGameScreen).
import type { GameState } from "./gameLogic";
import {
  getAllBalls,
  calculatePlayerBPM,
  calculatePlayerAccuracy,
  playerAccuracyCounts,
  SOLIDS,
  STRIPES,
  EIGHT_BALL,
  SHARK_PLAYER_NAME,
} from "./gameLogic";

/** Ball fill colors — mirrors the per-screen BALL_COLORS maps. */
export const WIDGET_BALL_COLORS: Record<number, string> = {
  1: "#FDD307", 2: "#1F4E9E", 3: "#C3342B", 4: "#5B247A",
  5: "#F27C1D", 6: "#276B40", 7: "#6B1F2A", 8: "#000000",
  9: "#FDD307", 10: "#1F4E9E", 11: "#C3342B", 12: "#5B247A",
  13: "#F27C1D", 14: "#276B40", 15: "#6B1F2A",
};

/** A single ball socket in the rack tray. */
export interface RackBall {
  ball: number;
  sunk: boolean;
  /** Pocketed by the invisible Shark opponent (Shark mode only). */
  sunkByShark: boolean;
}

/** One scoreboard row in the widget. */
export interface StreamPlayerRow {
  id: number;
  name: string;
  rainbow: boolean;
  /** "Solids" / "Stripes" / null (no group assigned, chaos, 9-ball, practice). */
  teamLabel: string | null;
  /** The player's whole group is off the table. */
  cleared: boolean;
  /** Balls this player personally pocketed (for the row's token strip). */
  sunk: number[];
  /** The current shooter (only while playing). */
  active: boolean;
  isHost: boolean;
  hasLeft: boolean;
  isShark: boolean;
}

/** Fully-resolved, presentational props for <StreamWidget>. */
export interface StreamWidgetData {
  /** Public watch handle shown in the title bar / footer (null when unknown). */
  handle: string | null;
  /** Public /watch URL for the footer QR + link (null to hide the QR). */
  watchUrl: string | null;
  /** "8-BALL" / "9-BALL" / "PRACTICE" / "SHARK". */
  modeLabel: string;
  playerCount: number;
  /** Hero pace number for the subject player (null = awaiting first pocket). */
  bpm: number | null;
  bpmSubject: string | null;
  bpmSubjectRainbow: boolean;
  /** Hero accuracy percent for the subject player. */
  accuracy: number | null;
  accuracyMade: number | null;
  accuracyAttempts: number | null;
  elapsedMs: number;
  gameOver: boolean;
  winnerName: string | null;
  winnerRainbow: boolean;
  winnerIsShark: boolean;
  rackLayout: "grouped" | "line";
  rack: RackBall[];
  players: StreamPlayerRow[];
}

interface RosterEntry {
  slotIndex: number;
  displayName: string;
  isHost: boolean;
  hasLeft: boolean;
  rainbowName: boolean;
}

const DEFAULT_RACK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function modeLabelOf(state: Partial<GameState> | null): string {
  if (!state?.gameType) return "8-BALL";
  if (state.gameType === "practice") return "PRACTICE";
  if (state.gameType === "9ball") return "9-BALL";
  // 8-ball: a solo game with a configured Shark opponent is "SHARK".
  if ((state.players?.length ?? 0) === 1 && state.sharkAggression !== undefined) {
    return "SHARK";
  }
  return "8-BALL";
}

/**
 * Normalize a game-state snapshot + server roster into the widget view-model.
 * Both surfaces call this so the live overlay and the shared image always
 * render identical figures. `elapsedMs` and `gameOver` are passed in because
 * each caller already computes the frozen-at-end clock its own way.
 */
export function buildStreamWidgetData(params: {
  state: Partial<GameState> | null;
  participants?: RosterEntry[];
  handle: string | null;
  watchUrl: string | null;
  elapsedMs: number;
  gameOver: boolean;
}): StreamWidgetData {
  const { state, participants = [], handle, watchUrl, elapsedMs, gameOver } = params;

  const rosterBySlot = new Map(participants.map((p) => [p.slotIndex, p]));
  const rainbowNames = new Set(
    participants.filter((p) => p.rainbowName).map((p) => p.displayName),
  );
  const isRainbow = (name: string | null | undefined): boolean =>
    !!name && rainbowNames.has(name);

  const players = state?.players ?? [];
  const sunk = state?.sunkBalls ?? [];
  const sharkSunk = state?.sharkSunkBalls ?? [];
  const shotLog = state?.shotLog ?? [];
  const currentIdx = state?.currentPlayerIndex ?? 0;

  // Subject of the hero stats: the winner once ended, else the current shooter.
  const cur = players[currentIdx];
  const subject = gameOver ? state?.winner ?? cur?.name ?? null : cur?.name ?? null;
  const bpm = subject ? calculatePlayerBPM(shotLog, subject) : null;
  const accuracy = subject ? calculatePlayerAccuracy(shotLog, subject) : null;
  const accCounts = subject ? playerAccuracyCounts(shotLog, subject) : null;

  // Rack tray.
  const allBalls = state?.gameType
    ? getAllBalls(state.gameType, state.practiceRack)
    : DEFAULT_RACK;
  const rack: RackBall[] = allBalls.map((b) => ({
    ball: b,
    sunk: sunk.includes(b),
    sunkByShark: sharkSunk.includes(b),
  }));
  const rackLayout: "grouped" | "line" =
    state?.gameType === "9ball" ||
    (state?.gameType === "practice" && state?.practiceRack === "9ball")
      ? "line"
      : "grouped";

  // Scoreboard rows — local players first, then any later-arriving roster slots
  // the host's local state hasn't caught up to yet.
  const rows: StreamPlayerRow[] = players.map((p, i) => {
    const roster = rosterBySlot.get(i);
    const shownName = roster?.displayName ?? p.name;
    const group = p.team === "solids" ? SOLIDS : p.team === "stripes" ? STRIPES : [];
    const cleared = group.length > 0 && group.every((b) => sunk.includes(b));
    const mySunk = shotLog
      .filter(
        (e) =>
          (e.type === "sink" || e.type === "win" || e.type === "lose") &&
          e.playerName === p.name &&
          typeof e.ball === "number",
      )
      .map((e) => e.ball as number);
    return {
      id: p.id,
      name: shownName,
      rainbow: roster?.rainbowName ?? isRainbow(shownName),
      teamLabel: p.team ? (p.team === "solids" ? "Solids" : "Stripes") : null,
      cleared,
      sunk: mySunk,
      active: state?.phase === "playing" && i === currentIdx,
      isHost: roster?.isHost ?? i === 0,
      hasLeft: roster?.hasLeft ?? false,
      isShark: shownName === SHARK_PLAYER_NAME,
    };
  });
  for (const rp of participants) {
    if (rp.slotIndex < players.length) continue;
    rows.push({
      id: 1000 + rp.slotIndex,
      name: rp.displayName,
      rainbow: rp.rainbowName,
      teamLabel: null,
      cleared: false,
      sunk: [],
      active: false,
      isHost: rp.isHost,
      hasLeft: rp.hasLeft,
      isShark: rp.displayName === SHARK_PLAYER_NAME,
    });
  }

  const winnerName = gameOver ? state?.winner ?? null : null;

  return {
    handle,
    watchUrl,
    modeLabel: modeLabelOf(state),
    playerCount: players.length || 0,
    bpm,
    bpmSubject: subject,
    bpmSubjectRainbow: isRainbow(subject),
    accuracy,
    accuracyMade: accCounts?.made ?? null,
    accuracyAttempts: accCounts?.attempts ?? null,
    elapsedMs,
    gameOver,
    winnerName,
    winnerRainbow: isRainbow(winnerName),
    winnerIsShark: winnerName === SHARK_PLAYER_NAME,
    rackLayout,
    rack,
    players: rows,
  };
}
