import { useState, useEffect, useRef, useCallback } from 'react';
import type { GameState, ShotLogEntry } from '../lib/gameLogic';
import {
  getLegalBalls, getRemainingBalls, checkSinkResult,
  assignTeams, shouldAssignTeams, calculateBPM, formatTime,
  encodeGameState, getTeamLabel, ballLabel,
  SOLIDS, STRIPES, EIGHT_BALL, getLowestBall,
} from '../lib/gameLogic';

interface Props {
  initialState: GameState;
  onNewGame: () => void;
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
  base += ok ? ' legal' : ' illegal';
  return base;
}

export default function GameScreen({ initialState, onNewGame }: Props) {
  const [state, setState] = useState<GameState>(initialState);
  const [elapsed, setElapsed] = useState(0);

  // BPM is a snapshot — only updated at the moment of each action, not in real-time.
  // This ensures it reflects pace during active play, not idle time.
  const [bpm, setBpm] = useState<number | null>(
    initialState.firstActionTime !== null
      ? calculateBPM(initialState.sunkBalls.length, initialState.firstActionTime, initialState.lastActionTime ?? Date.now())
      : null
  );

  const [toast, setToast] = useState('');
  const [undoStack, setUndoStack] = useState<GameState[]>([]);
  const [clock, setClock] = useState('');
  const [confirmNew, setConfirmNew] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // Practice-mode pause
  const [paused, setPaused] = useState(false);
  const [pausedDuration, setPausedDuration] = useState(0); // total ms spent paused
  const [pauseStart, setPauseStart] = useState<number | null>(null);

  const syncUrl = useCallback((s: GameState) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('state', encodeGameState(s));
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

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.shotLog]);

  const cur = state.players[state.currentPlayerIndex];
  const legalBalls = state.phase === 'playing'
    ? getLegalBalls(state.gameType, state.players, state.currentPlayerIndex, state.sunkBalls)
    : [];
  const allBalls = state.gameType === '9ball'
    ? [1, 2, 3, 4, 5, 6, 7, 8, 9]
    : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const remaining = getRemainingBalls(state.sunkBalls, state.gameType);
  const lowest9 = state.gameType === '9ball' ? getLowestBall(state.sunkBalls) : 0;

  function pushUndo(s: GameState) { setUndoStack(prev => [...prev.slice(-19), s]); }

  function applyState(next: GameState) { setState(next); syncUrl(next); }

  /**
   * Snap BPM at a specific moment in time.
   * Always called right after an action so the number freezes until the next one.
   */
  function snapBpm(sunkCount: number, firstActionTime: number, atTime: number) {
    setBpm(calculateBPM(sunkCount, firstActionTime, atTime));
  }

  function sinkBall(ball: number) {
    if (state.phase !== 'playing' || state.sunkBalls.includes(ball)) return;
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

    if (result.win) {
      next.phase = 'ended';
      next.winner = cur.name;
      next.winMessage = result.message;
    } else if (result.lose) {
      const winIdx = next.players.findIndex((_, i) => i !== next.currentPlayerIndex);
      next.phase = 'ended';
      next.winner = winIdx >= 0 ? next.players[winIdx].name : 'Opponent';
      next.winMessage = result.message;
    } else if (state.gameType === 'practice' && remaining.length === 1) {
      next.phase = 'ended';
      next.winner = cur.name;
      const finalBpm = calculateBPM(next.sunkBalls.length, next.firstActionTime!, now);
      next.winMessage = `Table cleared! Final BPM: ${finalBpm.toFixed(1)}`;
    }

    next.shotLog = [...next.shotLog, entry];

    // Snap BPM at the exact moment of this action
    snapBpm(next.sunkBalls.length, next.firstActionTime!, now);

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
        const winnerName = winnerIdx >= 0 ? state.players[winnerIdx].name : 'Opponent';
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
        snapBpm(next.sunkBalls.length, firstActionTime, now);
        applyState(next);
        return;
      }
    }

    const nextIdx = (state.currentPlayerIndex + 1) % state.players.length;
    const entry: ShotLogEntry = {
      type, playerName: cur.name,
      timestamp: now, gameTime: now - state.gameStartTime, note,
    };
    const next: GameState = {
      ...state,
      currentPlayerIndex: nextIdx,
      firstActionTime,
      lastActionTime: now,
      shotLog: [...state.shotLog, entry],
    };

    // BPM doesn't change on miss/foul/safety (no balls sunk) — but freeze the display
    // at this moment so it doesn't drift while the next player deliberates
    snapBpm(next.sunkBalls.length, firstActionTime, now);

    applyState(next);
  }

  function handleUndo() {
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(s => s.slice(0, -1));

    // Restore BPM to the snapshot at the time of that previous state's last action
    if (prev.firstActionTime) {
      setBpm(calculateBPM(prev.sunkBalls.length, prev.firstActionTime, prev.lastActionTime ?? Date.now()));
    } else {
      setBpm(null);
    }

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
    setBpm(null);
    setElapsed(0);
    setPaused(false);
    setPausedDuration(0);
    setPauseStart(null);
    applyState(fresh);
  }

  // Final BPM: snapshot at the last action, not at game-end time
  const finalBpm = state.firstActionTime
    ? calculateBPM(state.sunkBalls.length, state.firstActionTime, state.lastActionTime ?? Date.now())
    : null;

  const dispBpm = state.phase === 'ended' ? finalBpm : bpm;
  const dispTime = state.phase === 'playing' ? elapsed : (Date.now() - state.gameStartTime - pausedDuration);

  let selectorHint = '';
  if (state.gameType === '9ball') selectorHint = `Hit (${lowest9}) first`;
  else if (state.gameType === '8ball') {
    if (!state.teamAssigned) selectorHint = 'First sink assigns team';
    else selectorHint = cur.team ? getTeamLabel(cur.team) : '';
  }

  return (
    <div className="app-window">
      {/* Title bar */}
      <div className="titlebar">
        <div className="titlebar-left">
          <span className="titlebar-icon">🎱</span>
          <span className="titlebar-title">BreakBPM</span>
        </div>
        <div className="titlebar-btns">
          <button className="tb-btn">_</button>
          <button className="tb-btn">□</button>
          <button className="tb-btn" onClick={() => setConfirmNew(true)}>✕</button>
        </div>
      </div>

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
              {dispBpm === null ? 'AWAITING PLAY' : `${state.sunkBalls.length} SUNK`}
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
              <span className="hud-timer-indicator">{paused ? '⏸' : '▶'}</span>
            </div>
            <div className="hud-right-row">
              <span className="hud-meta-label">CODE</span>
              <span className="hud-code">{state.shareCode}</span>
            </div>
            <button className="hud-share-btn" onClick={handleShare}>
              {toast ? '✓ COPIED' : '📋 SHARE'}
            </button>
          </div>
        </div>

        {/* Sunk balls readout — full width within the panel */}
        <div className="hud-terminal">
          {state.sunkBalls.length === 0
            ? <span className="hud-terminal-idle">_ awaiting first shot_</span>
            : state.sunkBalls.map((b, i) => (
              <span
                key={i}
                className={`hud-chip ${b === 8 ? 'hud-chip-eight' : SOLIDS.includes(b) ? 'hud-chip-solid' : 'hud-chip-stripe'}`}
                style={{ '--chip-color': BALL_COLORS[b] } as React.CSSProperties}
              >
                {b}
              </span>
            ))
          }
        </div>

        {/* Win/Loss flash — inside HUD */}
        {state.phase === 'ended' && (
          <div className="hud-winner">
            <span className="hud-winner-text">
              {state.winner ? `★ ${state.winner.toUpperCase()} WINS` : 'GAME OVER'}
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
            {state.gameType === '8ball' && !state.teamAssigned && (
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
            <button className="btn btn-big" onClick={() => turnAction('miss')}><img src="/miss-icon.png" alt="Miss" style={{ width: 16, height: 16, marginRight: 5, verticalAlign: 'middle' }} />Miss</button>
            <button className="btn btn-big btn-danger" onClick={() => turnAction('foul', 'Ball in hand to opponent')}><img src="/foul-icon.png" alt="Foul" style={{ width: 16, height: 16, marginRight: 5, verticalAlign: 'middle' }} />Foul</button>
            {state.gameType === 'practice'
              ? <button className={`btn btn-big${paused ? ' btn-primary' : ''}`} onClick={handlePause}>{paused ? '▶ Resume' : '⏸ Pause'}</button>
              : <button className="btn btn-big" onClick={() => turnAction('safety', 'Safety — turn passes')}><img src="/safety-icon.png" alt="Safety" style={{ width: 16, height: 16, marginRight: 5, verticalAlign: 'middle' }} />Safety</button>
            }
            <button className="btn btn-big" onClick={handleUndo} disabled={!undoStack.length}><img src="/undo-icon.png" alt="Undo" style={{ width: 16, height: 16, marginRight: 5, verticalAlign: 'middle' }} />Undo</button>
          </div>
        )}

        {/* ── Shot log ── */}
        <div>
          <button
            className="btn w-full"
            style={{ justifyContent: 'space-between', minHeight: 32, fontSize: 12 }}
            onClick={() => setLogOpen(o => !o)}
          >
            <span>📋 Shot Log ({state.shotLog.length})</span>
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
                  return (
                    <div key={i} className={`log-entry ${e.type}`}>
                      {line}{e.note ? ` — ${e.note}` : ''}
                    </div>
                  );
                })
              }
            </div>
          )}
        </div>

        {state.phase === 'playing' && state.gameType === 'practice' && (
          <button className="btn w-full" onClick={handleReset}>
            ↺ Reset Table
          </button>
        )}
        {state.phase === 'playing' && (
          <button className="btn btn-danger w-full" onClick={() => setConfirmNew(true)}>
            ✖ End Game / New Game
          </button>
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
              <span style={{ fontSize: 28 }}>⚠</span>
              <div>
                <div style={{ fontWeight: 'bold', marginBottom: 4 }}>End current game?</div>
                <div style={{ fontSize: 12, color: '#444' }}>All progress will be lost.</div>
              </div>
            </div>
            <div className="grid-2">
              <button className="btn btn-primary btn-big" onClick={onNewGame}>Yes, end it</button>
              <button className="btn btn-big" onClick={() => setConfirmNew(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
