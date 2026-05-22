import { useState, useEffect, useRef, useCallback } from 'react';
import type { GameState, ShotLogEntry } from '../lib/gameLogic';
import Navbar from './Navbar';
import {
  getLegalBalls, getRemainingBalls, checkSinkResult,
  assignTeams, shouldAssignTeams, calculatePlayerBPM, formatTime,
  getTeamLabel, ballLabel,
  SOLIDS, STRIPES, EIGHT_BALL, getLowestBall,
  saveInProgressGame, clearInProgressGame,
  isSharkGame, applySharkMiss,
  getSharkPickCandidates, resolveSharkPick,
  SHARK_PLAYER_NAME,
} from '../lib/gameLogic';
import SharkIcon from './SharkIcon';
import { useSaveGame, useRecordGameActivity, useGetMe } from '@workspace/api-client-react';
import { FORFEIT_INACTIVITY_MS } from '../lib/forfeit';

interface Props {
  initialState: GameState;
  /** Server-issued in-progress game id (null for anonymous play). */
  serverGameId: string | null;
  /**
   * Hard wall-clock cap from the server. Set for anonymous play (1 hr);
   * null for signed-in users (who use the inactivity timeout instead).
   */
  maxGameDurationMs: number | null;
  /**
   * Accumulated paused-time (practice mode) carried over from a restored
   * in-progress game so the elapsed-time clock stays exact across
   * refresh. Defaults to 0 for fresh games.
   */
  initialPausedDuration?: number;
  onNewGame: () => void;
  onAbout: () => void;
  onAccount: () => void;
  onSignIn: () => void;
}


const BALL_COLORS: Record<number, string> = {
  1: '#FDD307', 2: '#1F4E9E', 3: '#C3342B', 4: '#5B247A',
  5: '#F27C1D', 6: '#276B40', 7: '#6B1F2A', 8: '#000000',
  9: '#FDD307', 10: '#1F4E9E', 11: '#C3342B', 12: '#5B247A',
  13: '#F27C1D', 14: '#276B40', 15: '#6B1F2A',
};

function ballClass(ball: number, legal: number[], sunk: number[], _gameType: string) {
  if (sunk.includes(ball)) return 'ball-btn sunk';
  const ok = legal.includes(ball);
  let base = 'ball-btn';
  if (ball === EIGHT_BALL) base += ' eight';
  else if (SOLIDS.includes(ball)) base += ' solid';
  else base += ' stripe';
  if (ok) base += ' legal';
  else base += ' illegal';
  return base;
}

export default function GameScreen({ initialState, serverGameId, maxGameDurationMs, initialPausedDuration = 0, onNewGame, onAbout, onAccount, onSignIn }: Props) {
  const saveGame = useSaveGame();
  const recordActivity = useRecordGameActivity();
  const me = useGetMe();
  const hasActivePass = me.data?.entitlement?.hasActivePass ?? false;
  const savedRef = useRef(false);
  const forfeitedRef = useRef(false);
  const [state, setState] = useState<GameState>(initialState);
  const [elapsed, setElapsed] = useState(0);

  // BPM is per-player and derived from the shot log + lastActionTime
  // (see `dispBpm` below). No standalone bpm state is kept.

  const [toast, setToast] = useState('');
  const [undoStack, setUndoStack] = useState<GameState[]>([]);
  const [clock, setClock] = useState('');
  const [confirmNew, setConfirmNew] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // Practice-mode pause. Seed pausedDuration from a restored in-progress
  // game so the elapsed clock continues from where it left off.
  const [paused, setPaused] = useState(false);
  const [pausedDuration, setPausedDuration] = useState(initialPausedDuration);
  const [pauseStart, setPauseStart] = useState<number | null>(null);

  // URL now carries only the join `?game=` share code. The full encoded
  // `?state=` payload is no longer written on every change — localStorage
  // is the source of truth for refresh recovery, and the old `?state=`
  // path is decode-only for legacy share links (handled in App.tsx).
  const syncUrl = useCallback((s: GameState) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('state');
      url.searchParams.set('game', s.shareCode);
      window.history.replaceState(null, '', url.toString());
    } catch { /* noop */ }
  }, []);

  // Timer — only tracks elapsed time. BPM is NOT updated here.
  // Stops when paused; pausedDuration is subtracted so the displayed time excludes idle pauses.
  useEffect(() => {
    if (state.phase !== 'playing' || paused) return;
    const id = setInterval(() => {
      setElapsed(Date.now() - state.gameStartTime - pausedDuration);
    }, 1000);
    return () => clearInterval(id);
  }, [state.phase, state.gameStartTime, paused, pausedDuration]);

  // System clock
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, []);

  // Sync URL on state change
  useEffect(() => { syncUrl(state); }, [state, syncUrl]);

  // Persist the full in-progress game (state + server gameId + wall-clock
  // cap + pause accumulator) to localStorage on every change so a refresh
  // / tab-close / connection drop can rehydrate it on the next mount.
  // Cleared as soon as the game ends (post-save).
  useEffect(() => {
    if (state.phase !== 'playing') return;
    saveInProgressGame({
      state,
      serverGameId,
      maxGameDurationMs,
      pausedDuration,
      savedAt: Date.now(),
    });
  }, [state, serverGameId, maxGameDurationMs, pausedDuration]);

  // Auto-save the game once when it ends. Anonymous calls return saved:false
  // and are silently ignored — saved games show up in the user's history.
  useEffect(() => {
    if (state.phase !== 'ended' || savedRef.current) return;
    savedRef.current = true;
    // Saved BPM is the winning player's per-player BPM. In Shark Mode we
    // always save the human's BPM regardless of who won (Shark has no
    // meaningful pace metric).
    const bpmPlayerName = isSharkGame(state)
      ? state.players[0]?.name ?? ''
      : (state.winner ?? state.players[state.currentPlayerIndex]?.name ?? '');
    const finalBpmSnap = bpmPlayerName
      ? calculatePlayerBPM(state.shotLog, bpmPlayerName)
      : null;
    saveGame.mutate(
      {
        data: {
          // If signed-in, finalize the in-progress server-side row. Anonymous
          // play is dropped on the server side (no row stored).
          gameId: serverGameId,
          gameType: state.gameType,
          shareCode: state.shareCode,
          winner: state.winner,
          bpm: finalBpmSnap,
          durationMs: Math.max(0, Date.now() - state.gameStartTime - pausedDuration),
          sunkBallsCount: state.sunkBalls.length,
          outcome: forfeitedRef.current ? 'forfeit' : (state.winner ? 'won' : 'completed'),
          gameState: state as unknown as Record<string, unknown>,
          startedAt: new Date(state.gameStartTime).toISOString(),
        },
      },
      {
        // Drop the in-progress checkpoint only on successful save. On
        // failure (network/server) we keep the checkpoint so a retry on
        // the next mount can replay the finalize against the same row.
        onSuccess: () => clearInProgressGame(),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // Forfeit timer — if no action for FORFEIT_INACTIVITY_MS (60min) the game is
  // automatically ended as a forfeit by the current player. Practice mode is
  // exempt (it has manual pause). Pauses suspend the timer.
  useEffect(() => {
    // Shark mode is solo (no opponent waiting on you) — treat it like
    // practice and skip the 60-min inactivity forfeit.
    if (state.phase !== 'playing' || state.gameType === 'practice' || isSharkGame(state) || paused) return;
    const lastAction = state.lastActionTime ?? state.gameStartTime;
    const deadline = lastAction + FORFEIT_INACTIVITY_MS;
    const ms = deadline - Date.now();
    if (ms <= 0) {
      // Already past the deadline — forfeit immediately
      forfeitedRef.current = true;
      const now = Date.now();
      const winnerName = state.players.length > 1
        ? state.players[(state.currentPlayerIndex + 1) % state.players.length].name
        : null;
      setState(s => ({
        ...s,
        phase: 'ended',
        winner: winnerName,
        winMessage: `${s.players[s.currentPlayerIndex].name} forfeited (60min inactivity)`,
        lastActionTime: now,
      }));
      return;
    }
    const id = setTimeout(() => {
      forfeitedRef.current = true;
      const now = Date.now();
      const winnerName = state.players.length > 1
        ? state.players[(state.currentPlayerIndex + 1) % state.players.length].name
        : null;
      setState(s => ({
        ...s,
        phase: 'ended',
        winner: winnerName,
        winMessage: `${s.players[s.currentPlayerIndex].name} forfeited (60min inactivity)`,
        lastActionTime: now,
      }));
    }, ms);
    return () => clearTimeout(id);
  }, [state.phase, state.lastActionTime, state.gameStartTime, state.currentPlayerIndex, state.gameType, state.players, paused]);

  // Hard wall-clock cap for anonymous play. Server returns 1hr in
  // maxGameDurationMs; once we hit it, the game ends as a forfeit so the
  // session can't run forever. Practice mode is exempt (no opponent).
  useEffect(() => {
    if (state.phase !== 'playing' || paused) return;
    if (maxGameDurationMs == null || state.gameType === 'practice' || isSharkGame(state)) return;
    const ms = state.gameStartTime + maxGameDurationMs - Date.now();
    const fire = () => {
      forfeitedRef.current = true;
      const winnerName = state.players.length > 1
        ? state.players[(state.currentPlayerIndex + 1) % state.players.length].name
        : null;
      setState(s => ({
        ...s,
        phase: 'ended',
        winner: winnerName,
        winMessage: `Session ended — anonymous games are capped at ${Math.round(maxGameDurationMs / 60000)} minutes. Sign in to play longer.`,
        lastActionTime: Date.now(),
      }));
    };
    if (ms <= 0) { fire(); return; }
    const id = setTimeout(fire, ms);
    return () => clearTimeout(id);
  }, [state.phase, state.gameStartTime, state.gameType, state.players, state.currentPlayerIndex, paused, maxGameDurationMs]);

  // Server activity ping — fires on every logged action
  // (sink/miss/foul/safety bumps state.lastActionTime) AND once on mount
  // so /games/resume has a full snapshot from the very first moment.
  // Deliberately NOT a periodic heartbeat: that would let users dodge the
  // 60-min inactivity forfeit just by leaving the tab open. Only
  // signed-in users have a server-side row to update.
  useEffect(() => {
    if (!serverGameId || state.phase !== 'playing') return;
    // Piggy-back the full client-side snapshot so /games/resume can offer
    // this game on a different device or after localStorage is cleared.
    recordActivity.mutate({
      data: {
        gameId: serverGameId,
        gameState: state as unknown as Record<string, unknown>,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverGameId, state.lastActionTime, state.phase]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.shotLog]);

  const cur = state.players[state.currentPlayerIndex];
  const pendingSharkPick = state.phase === 'playing' && !!state.pendingSharkPick;
  const sharkPickCandidates = pendingSharkPick ? getSharkPickCandidates(state) : [];
  const legalBalls = state.phase !== 'playing'
    ? []
    : pendingSharkPick
      ? sharkPickCandidates
      : getLegalBalls(state.gameType, state.players, state.currentPlayerIndex, state.sunkBalls);
  const allBalls = state.gameType === '9ball'
    ? [1, 2, 3, 4, 5, 6, 7, 8, 9]
    : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const remaining = getRemainingBalls(state.sunkBalls, state.gameType);
  const lowest9 = state.gameType === '9ball' ? getLowestBall(state.sunkBalls) : 0;

  function pushUndo(s: GameState) { setUndoStack(prev => [...prev.slice(-19), s]); }

  function applyState(next: GameState) { setState(next); syncUrl(next); }

  function sinkBall(ball: number) {
    if (state.phase !== 'playing' || state.sunkBalls.includes(ball)) return;

    // Resolving a pending Shark sink — player tapped the ball they removed
    // from the table. No new undo entry: undoing rolls back to before the
    // miss/foul that triggered the pending state.
    if (state.pendingSharkPick) {
      const candidates = getSharkPickCandidates(state);
      if (!candidates.includes(ball)) return;
      const next = resolveSharkPick(state, ball);
      applyState(next);
      return;
    }

    // Note: in Shark mode, the Shark's group balls are filtered out by
    // getLegalBalls after team assignment, and the selector's illegal styling
    // prevents taps — same as 2P 8-ball. There's no foul-routing branch here.

    resumeIfPaused();
    pushUndo(state);

    const now = Date.now();
    let next = { ...state };

    // Record first action time if this is the first event
    if (!next.firstActionTime) next.firstActionTime = now;
    next.lastActionTime = now;

    if (shouldAssignTeams(state.gameType, state.teamAssigned, state.players, state.currentPlayerIndex, ball)) {
      next.players = assignTeams(state.players, state.currentPlayerIndex, ball);
      next.teamAssigned = true;
    }

    next.sunkBalls = [...next.sunkBalls, ball];

    const result = checkSinkResult(next.gameType, next.players, next.currentPlayerIndex, state.sunkBalls, ball);

    const entry: ShotLogEntry = {
      type: result.win ? 'win' : result.lose ? 'lose' : 'sink',
      playerName: cur.name,
      ball,
      timestamp: now,
      gameTime: now - state.gameStartTime,
      note: result.message || undefined,
    };
    // Stamp the player's per-player BPM at the moment of this pocket. We
    // pass the about-to-be-pushed log so this entry is included in the
    // calculation (otherwise the very first sink wouldn't anchor).
    const entryBpm = calculatePlayerBPM([...next.shotLog, entry], cur.name);
    if (entryBpm !== null) entry.bpm = entryBpm;

    if (result.win) {
      next.phase = 'ended';
      next.winner = cur.name;
      next.winMessage = result.message;
      // Shark mode: append Balls-Per-Shot as a displayed stat (not a verdict).
      if (isSharkGame(next)) {
        const sharkBalls = next.sharkSunkBalls ?? [];
        const yourSinks = next.sunkBalls.filter(b => !sharkBalls.includes(b)).length;
        const yourShots = next.shotLog.filter(e => e.playerName !== SHARK_PLAYER_NAME).length + 1;
        const bps = yourShots > 0 ? yourSinks / yourShots : 0;
        next.winMessage = `🎉 ${result.message} (${bps.toFixed(2)} balls/shot)`;
      }
    } else if (result.lose) {
      next.phase = 'ended';
      next.winMessage = result.message;
      if (isSharkGame(next)) {
        // Shark mode: the Shark is the only opponent. Append BPS as a stat.
        next.winner = SHARK_PLAYER_NAME;
        const sharkBalls = next.sharkSunkBalls ?? [];
        const yourSinks = next.sunkBalls.filter(b => !sharkBalls.includes(b)).length;
        const yourShots = next.shotLog.filter(e => e.playerName !== SHARK_PLAYER_NAME).length + 1;
        const bps = yourShots > 0 ? yourSinks / yourShots : 0;
        next.winMessage = `${result.message} (${bps.toFixed(2)} balls/shot)`;
      } else {
        const winIdx = next.players.findIndex((_, i) => i !== next.currentPlayerIndex);
        next.winner = winIdx >= 0 ? next.players[winIdx].name : 'Opponent';
      }
    } else if (state.gameType === 'practice' && remaining.length === 1) {
      next.phase = 'ended';
      next.winner = cur.name;
      const finalBpm = calculatePlayerBPM([...next.shotLog, entry], cur.name) ?? 0;
      next.winMessage = `Table cleared! Final BPM: ${finalBpm.toFixed(1)}`;
    }

    next.shotLog = [...next.shotLog, entry];

    applyState(next);
  }

  function turnAction(type: 'miss' | 'foul' | 'safety', note?: string) {
    if (state.phase !== 'playing') return;
    resumeIfPaused();
    pushUndo(state);

    const now = Date.now();
    const firstActionTime = state.firstActionTime ?? now;

    // Foul-on-8 rule: if the player fouls while the 8-ball is their only
    // remaining legal ball (group fully cleared), it's an instant loss.
    if (
      type === 'foul' &&
      state.gameType === '8ball' &&
      state.teamAssigned &&
      cur.team &&
      !state.sunkBalls.includes(EIGHT_BALL)
    ) {
      const myGroup = cur.team === 'solids' ? SOLIDS : STRIPES;
      const groupCleared = myGroup.every(b => state.sunkBalls.includes(b));
      if (groupCleared) {
        const winnerIdx = state.players.findIndex((_, i) => i !== state.currentPlayerIndex);
        const winnerName = isSharkGame(state)
          ? SHARK_PLAYER_NAME
          : (winnerIdx >= 0 ? state.players[winnerIdx].name : 'Opponent');
        const entry: ShotLogEntry = {
          type: 'lose', playerName: cur.name,
          timestamp: now, gameTime: now - state.gameStartTime,
          note: 'Foul on the 8-ball',
        };
        const next: GameState = {
          ...state,
          phase: 'ended',
          winner: winnerName,
          winMessage: `${cur.name} fouled on the 8-ball — ${winnerName} wins!`,
          firstActionTime,
          lastActionTime: now,
          shotLog: [...state.shotLog, entry],
        };
        applyState(next);
        return;
      }
    }

    const nextIdx = (state.currentPlayerIndex + 1) % state.players.length;
    const entry: ShotLogEntry = {
      type, playerName: cur.name,
      timestamp: now, gameTime: now - state.gameStartTime, note,
    };
    let next: GameState = {
      ...state,
      currentPlayerIndex: nextIdx,
      firstActionTime,
      lastActionTime: now,
      shotLog: [...state.shotLog, entry],
    };

    // Shark mode: after recording the player's miss/foul, let the Shark
    // steal a random ball (Normal = miss only; Hard = miss + foul). This
    // may also end the game if the only ball left was the 8.
    // Safeties never trigger a steal — they're a valid tactical play.
    if (isSharkGame(next) && (type === 'miss' || type === 'foul')) {
      next = applySharkMiss(next, type);
    }

    // BPM is derived from the shot log + lastActionTime, so no snapshot needed.
    applyState(next);
  }

  function handleUndo() {
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(s => s.slice(0, -1));
    applyState(prev);
  }

  function handleShare() {
    const url = window.location.href;
    navigator.clipboard.writeText(url)
      .then(() => { setToast('URL copied!'); setTimeout(() => setToast(''), 2000); })
      .catch(() => { setToast('Copy URL above'); setTimeout(() => setToast(''), 3000); });
  }

  function handlePause() {
    if (!paused) {
      // Freeze elapsed precisely at this moment before the interval stops
      setElapsed(Date.now() - state.gameStartTime - pausedDuration);
      setPaused(true);
      setPauseStart(Date.now());
    } else {
      const added = pauseStart ? Date.now() - pauseStart : 0;
      setPausedDuration(d => d + added);
      setPauseStart(null);
      setPaused(false);
    }
  }

  function resumeIfPaused() {
    if (!paused) return;
    const added = pauseStart ? Date.now() - pauseStart : 0;
    setPausedDuration(d => d + added);
    setPauseStart(null);
    setPaused(false);
  }

  function handleReset() {
    const now = Date.now();
    const fresh: GameState = {
      ...state,
      phase: 'playing',
      sunkBalls: [],
      shotLog: [],
      firstActionTime: null,
      lastActionTime: null,
      gameStartTime: now,
      winner: null,
      winMessage: '',
    };
    setUndoStack([]);
    setElapsed(0);
    setPaused(false);
    setPausedDuration(0);
    setPauseStart(null);
    applyState(fresh);
  }

  // BPM is per-player and derived entirely from the shot log. During play
  // the HUD shows the current shooter's BPM; at game end it shows the
  // winner's (or the human's in Shark Mode). The endpoint is each player's
  // own most recent log entry, so the number stays frozen between their
  // shots and isn't extended by the opponent (or by Shark steals).
  const dispPlayerName = state.phase === 'ended'
    ? (isSharkGame(state) ? state.players[0]?.name : (state.winner ?? cur?.name))
    : cur?.name;
  const dispBpm = dispPlayerName
    ? calculatePlayerBPM(state.shotLog, dispPlayerName)
    : null;
  const dispTime = state.phase === 'playing' ? elapsed : (Date.now() - state.gameStartTime - pausedDuration);

  // Sublabel under the hero BPM: how many balls the shooter still needs to
  // pocket. In 8-ball (and Shark) after teams are assigned, this is the
  // current player's own group (or "8-BALL TO WIN" once their group is
  // cleared). Otherwise it's the table total.
  let remainingSubLabel = '';
  if (state.gameType === '8ball' && state.teamAssigned && cur?.team) {
    const myGroup = cur.team === 'solids' ? SOLIDS : STRIPES;
    const myLeft = myGroup.filter(b => !state.sunkBalls.includes(b)).length;
    const eightLeft = state.sunkBalls.includes(EIGHT_BALL) ? 0 : 1;
    if (myLeft === 0) {
      // Group cleared — only the 8 stands between them and the win.
      remainingSubLabel = '8-BALL TO WIN';
    } else {
      // Group balls still on the table — include the 8 in the count so
      // the readout reflects everything this shooter still needs to pocket.
      const total = myLeft + eightLeft;
      remainingSubLabel = `${total} ${cur.team === 'solids' ? 'SOLIDS' : 'STRIPES'} LEFT`;
    }
  } else {
    const left = getRemainingBalls(state.sunkBalls, state.gameType).length;
    remainingSubLabel = `${left} BALLS LEFT`;
  }

  let selectorHint: React.ReactNode = '';
  if (pendingSharkPick) selectorHint = <><SharkIcon size={14} /> Tap the ball you removed from the table</>;
  else if (state.gameType === '9ball') selectorHint = `Hit (${lowest9}) first`;
  else if (state.gameType === '8ball') {
    if (!state.teamAssigned) selectorHint = 'First sink assigns team';
    else selectorHint = cur.team ? getTeamLabel(cur.team) : '';
  }

  return (
    <div className="app-window">
      <Navbar onAbout={onAbout} onAccount={onAccount} onSignIn={onSignIn} />

      {/* ── Dark HUD panel (matches splash aesthetic) ── */}
      <div className="hud-panel">

        {/* Top row: BPM + right column */}
        <div className="hud-top">

          {/* BPM — the hero number */}
          <div className="hud-bpm-block">
            <div className="hud-bpm-label">BALLS/MIN</div>
            <div className={`hud-bpm-value${dispBpm === null ? ' hud-bpm-dim' : ''}`}>
              {dispBpm !== null ? dispBpm.toFixed(1) : '--.-'}
            </div>
            <div className="hud-bpm-sub">
              {dispBpm === null ? 'AWAITING PLAY' : remainingSubLabel}
            </div>
          </div>

          {/* Divider */}
          <div className="hud-divider" />

          {/* Right: mode + timer + share */}
          <div className="hud-right">
            <div className="hud-right-row">
              <span className="hud-meta-label">MODE</span>
              <span className="hud-mode">
                {state.gameType === 'practice' ? 'PRACTICE'
                  : state.gameType === '8ball' ? '8-BALL'
                  : '9-BALL'}
                <span className="hud-mode-players"> · {state.players.length}P</span>
              </span>
            </div>
            <div className="hud-right-row">
              <span className="hud-meta-label">TIME</span>
              <span className={`hud-timer${paused ? ' hud-timer-paused' : ''}`}>{formatTime(dispTime)}</span>
            </div>
            <div className="hud-right-row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="hud-meta-label">CODE</span>
              <span className="hud-code">{state.shareCode}</span>
              <button
                className="hud-copy-code-btn"
                onClick={() => { navigator.clipboard.writeText(state.shareCode); }}
                title="Copy code"
              >
                <img src="/copy-icon.png" alt="Copy code" style={{ height: 23, width: 'auto', display: 'block' }} />
              </button>
            </div>
          </div>
        </div>

        {/* Sunk balls readout — full width within the panel */}
        <div className="hud-terminal">
          {state.sunkBalls.length === 0
            ? <span className="hud-terminal-idle">&gt;awaiting first shot</span>
            : state.sunkBalls.map((b, i) => {
              const sunkByShark = (state.sharkSunkBalls ?? []).includes(b);
              return (
                <span
                  key={i}
                  className={`hud-chip ${b === 8 ? 'hud-chip-eight' : SOLIDS.includes(b) ? 'hud-chip-solid' : 'hud-chip-stripe'}`}
                  style={{
                    '--chip-color': BALL_COLORS[b],
                    ...(sunkByShark ? { opacity: 0.45 } : {}),
                  } as React.CSSProperties}
                  title={sunkByShark ? 'Sunk by the Shark' : undefined}
                >
                  {b}
                </span>
              );
            })
          }
        </div>

        {/* Shark score — only shown in shark mode */}
        {isSharkGame(state) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 8px', marginTop: 4,
            background: '#1a0a2e', border: '1px solid #5a2a8a',
            fontFamily: "'VT323',monospace", fontSize: 14, color: '#d8b4ff',
          }}>
            <SharkIcon size={16} /><span>SHARK</span>
            <span style={{ marginLeft: 'auto', fontWeight: 'bold' }}>
              {(state.sharkSunkBalls ?? []).length} stolen
            </span>
          </div>
        )}

        {/* Win/Loss flash — inside HUD */}
        {state.phase === 'ended' && (
          <div className="hud-winner">
            <span className="hud-winner-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {state.winner ? (
                <>
                  ★ {state.winner === SHARK_PLAYER_NAME && <SharkIcon size={21} />}
                  {state.winner.toUpperCase()} WINS
                </>
              ) : 'GAME OVER'}
            </span>
            <span className="hud-winner-sub">{state.winMessage}</span>
          </div>
        )}
      </div>

      <div className="app-body">

        {/* Win screen action buttons */}
        {state.phase === 'ended' && (
          <div className="grid-2" style={{ marginTop: 0 }}>
            <button className="btn btn-primary btn-big" onClick={onNewGame}>▶ New Game</button>
            <button className="btn btn-big" onClick={handleShare}>📋 Share</button>
          </div>
        )}

        {/* ── Players ── */}
        {state.phase === 'playing' && state.gameType !== 'practice' && (
          <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
            {state.players.map((p, i) => {
              const active = i === state.currentPlayerIndex;
              const myGroup = p.team === 'solids' ? SOLIDS : p.team === 'stripes' ? STRIPES : [];
              const cleared = myGroup.length > 0 && myGroup.every(b => state.sunkBalls.includes(b));
              return (
                <div key={p.id} style={{
                  flex: 1, minWidth: 70,
                  border: `2px solid ${active ? '#000080' : '#808080'}`,
                  background: active ? '#e8f0ff' : '#c0c0c0',
                  padding: '4px 6px',
                }}>
                  <div style={{ fontWeight: 'bold', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {active ? '▶ ' : ''}{p.name}
                  </div>
                  <div style={{ fontSize: 10, color: p.team === 'solids' ? '#000080' : p.team === 'stripes' ? '#804000' : '#444' }}>
                    {p.team ? (p.team === 'solids' ? 'Solids' : 'Stripes') : 'TBD'}
                    {cleared && <span style={{ color: '#006400', fontWeight: 'bold' }}> ✓</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Ball selector ── */}
        {state.phase !== 'ended' && (
          <div>
            <div className="menu-section-label" style={{ marginBottom: 6 }}>
              {state.gameType === 'practice' ? 'BALL SELECTOR'
                : `${cur.name.toUpperCase()}'S TURN`}
              {selectorHint && <span style={{ fontWeight: 'normal', marginLeft: 8, letterSpacing: 0, textTransform: 'none', color: '#555' }}>{selectorHint}</span>}
            </div>
            <div className="ball-grid">
              {allBalls.map(ball => (
                <button
                  key={ball}
                  className={ballClass(ball, legalBalls, state.sunkBalls, state.gameType)}
                  onClick={() => sinkBall(ball)}
                  style={{ '--ball-color': BALL_COLORS[ball] } as React.CSSProperties}
                >
                  <span className="ball-num">{ball}</span>
                </button>
              ))}
            </div>
            {pendingSharkPick && (
              <div className="notice" style={{ marginTop: 6, background: '#1a0a2e', color: '#d8b4ff', borderColor: '#5a2a8a' }}>
                <SharkIcon size={16} />
                <span style={{ fontSize: 11 }}>
                  The Shark sinks a ball — remove one from the table and tap it above.
                </span>
              </div>
            )}
            {state.gameType === '8ball' && !state.teamAssigned && !pendingSharkPick && (
              <div className="notice" style={{ marginTop: 6 }}>
                <span>💡</span>
                <span style={{ fontSize: 11 }}>First ball sunk assigns Solids (1-7) or Stripes (9-15)</span>
              </div>
            )}
          </div>
        )}

        {/* ── Actions ── */}
        {state.phase === 'playing' && (
          <div className="action-grid">
            <button className="btn btn-big" onClick={() => turnAction('miss')} disabled={pendingSharkPick}><img src="/miss-icon.png" alt="Miss" style={{ width: 16, height: 16, marginRight: 5, verticalAlign: 'middle' }} />Miss</button>
            <button className="btn btn-big btn-danger" onClick={() => turnAction('foul', 'Ball to opponent')} disabled={pendingSharkPick}><img src="/foul-icon.png" alt="Foul" style={{ width: 16, height: 16, marginRight: 5, verticalAlign: 'middle' }} />Foul</button>
            {state.gameType === 'practice'
              ? <button className={`btn btn-big${paused ? ' btn-primary' : ''}`} onClick={handlePause}>{paused ? '▶️ Resume' : '⏸️ Pause'}</button>
              : <button className="btn btn-big" onClick={() => turnAction('safety', 'Safety — turn passes')} disabled={pendingSharkPick}><img src="/safety-icon.png" alt="Safety" style={{ width: 16, height: 16, marginRight: 5, verticalAlign: 'middle' }} />Safety</button>
            }
            <button className="btn btn-big" onClick={handleUndo} disabled={!undoStack.length}><img src="/undo-icon.png" alt="Undo" style={{ width: 16, height: 16, marginRight: 5, verticalAlign: 'middle' }} />Undo</button>
          </div>
        )}

        {/* ── Shot log ── */}
        <div>
          <button
            className="btn w-full"
            style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', minHeight: 32, fontSize: 12 }}
            onClick={() => setLogOpen(o => !o)}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><img src="/history-icon.png" alt="History" style={{ width: 16, height: 16, flexShrink: 0 }} />Game History ({state.shotLog.length})</span>
            <span>{logOpen ? '▲' : '▼'}</span>
          </button>
          {logOpen && (
            <div className="shot-log" ref={logRef}>
              {state.shotLog.length === 0
                ? <div style={{ color: '#006600' }}>_ no shots yet...</div>
                : state.shotLog.map((e, i) => {
                  const t = formatTime(e.gameTime);
                  let line = '';
                  if (e.type === 'sink') line = `[${t}] ${e.playerName} » SINK ${ballLabel(e.ball!)}`;
                  else if (e.type === 'foul') line = `[${t}] ${e.playerName} » FOUL`;
                  else if (e.type === 'safety') line = `[${t}] ${e.playerName} » SAFETY`;
                  else if (e.type === 'miss') line = `[${t}] ${e.playerName} » MISS`;
                  else if (e.type === 'win') line = `[${t}] ${e.playerName} » WIN! ${e.ball ? ballLabel(e.ball) : ''}`;
                  else if (e.type === 'lose') line = `[${t}] ${e.playerName} » LOSS`;
                  const bpmTag = e.bpm !== undefined ? ` · ${e.bpm.toFixed(1)} BPM` : '';
                  return (
                    <div key={i} className={`log-entry ${e.type}`}>
                      {line}{bpmTag}{e.note ? ` — ${e.note}` : ''}
                    </div>
                  );
                })
              }
            </div>
          )}
        </div>

        {state.phase === 'playing' && (
          <div style={{ display: 'flex', gap: 8 }}>
            {state.gameType === 'practice' && (
              <button className="btn btn-big" style={{ flex: 1 }} onClick={handleReset}>
                <img src="/reset-icon.png" alt="Reset" style={{ width: 16, height: 16, marginRight: 5, verticalAlign: 'middle' }} />Reset Table
              </button>
            )}
            <button className="btn btn-big btn-danger" style={{ flex: 1 }} onClick={() => setConfirmNew(true)}>
              <img src="/endgame-icon.png" alt="End Game" style={{ width: 16, height: 16, marginRight: 5, verticalAlign: 'middle' }} />End Game / New Game
            </button>
          </div>
        )}

      </div>

      {/* Status bar */}
      <div className="statusbar">
        <div className="statusbar-item" style={{ flex: 2 }}>
          {paused ? '⏸ PAUSED'
            : state.phase === 'playing' ? `▶ ${cur.name}'s turn`
            : state.phase === 'ended' ? '■ Game Over' : '—'}
        </div>
        <div className="statusbar-item" style={{ flex: 1 }}>
          BPM: {dispBpm !== null ? dispBpm.toFixed(1) : '--'}
        </div>
        <div className="statusbar-item">{clock}</div>
      </div>

      {/* Confirm dialog */}
      {confirmNew && (
        <div className="dialog-overlay" onClick={() => setConfirmNew(false)}>
          <div className="dialog-box" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
              <img src="/foul-icon.png" alt="Warning" style={{ width: 28, height: 28, imageRendering: 'pixelated', flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 'bold', marginBottom: 4 }}>End current game?</div>
                {!hasActivePass && (
                  <div style={{ fontSize: 12, color: '#444' }}>All progress will be lost.</div>
                )}
              </div>
            </div>
            <div className="grid-2">
              <button className="btn btn-primary btn-big" onClick={onNewGame}>Yes</button>
              <button className="btn btn-big" onClick={() => setConfirmNew(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
