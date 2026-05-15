import { useState, useEffect, useRef, useCallback } from 'react';
import type { GameState, ShotLogEntry } from '../lib/gameLogic';
import {
  getLegalBalls, getRemainingBalls, checkSinkResult,
  assignTeams, shouldAssignTeams, calculateBPM, formatTime,
  encodeGameState, getTeamLabel, ballLabel,
  SOLIDS, STRIPES, EIGHT_BALL, getLowestBall,
} from '../lib/gameLogic';
import ballImg from '/eightball_nobg.png';

interface Props {
  initialState: GameState;
  onNewGame: () => void;
}

function ballClass(ball: number, legal: number[], sunk: number[], gameType: string) {
  if (sunk.includes(ball)) return 'ball-btn sunk';
  const ok = legal.includes(ball);
  let base = 'ball-btn';
  if (ball === EIGHT_BALL) base += ' eight';
  else if (ball === 9 && gameType === '9ball') base += ' nine';
  else if (SOLIDS.includes(ball)) base += ' solid';
  else if (STRIPES.includes(ball)) base += ' stripe';
  base += ok ? ' legal' : ' illegal';
  return base;
}

export default function GameScreen({ initialState, onNewGame }: Props) {
  const [state, setState] = useState<GameState>(initialState);
  const [elapsed, setElapsed] = useState(0);
  const [bpm, setBpm] = useState(0);
  const [toast, setToast] = useState('');
  const [undoStack, setUndoStack] = useState<GameState[]>([]);
  const [clock, setClock] = useState('');
  const [confirmNew, setConfirmNew] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const syncUrl = useCallback((s: GameState) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('state', encodeGameState(s));
      url.searchParams.set('game', s.shareCode);
      window.history.replaceState(null, '', url.toString());
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    if (state.phase !== 'playing') return;
    const id = setInterval(() => {
      setElapsed(Date.now() - state.gameStartTime);
      setBpm(calculateBPM(state.sunkBalls.length, state.gameStartTime));
    }, 500);
    return () => clearInterval(id);
  }, [state.phase, state.gameStartTime, state.sunkBalls.length]);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { syncUrl(state); }, [state, syncUrl]);

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
  const finalBpm = calculateBPM(state.sunkBalls.length, state.gameStartTime);
  const dispBpm = state.phase === 'playing' ? bpm : finalBpm;
  const dispTime = state.phase === 'playing' ? elapsed : (Date.now() - state.gameStartTime);

  let selectorHint = '';
  if (state.gameType === '9ball') selectorHint = `Must hit (${lowest9}) first`;
  else if (state.gameType === '8ball') {
    if (!state.teamAssigned) selectorHint = 'First sink assigns team';
    else selectorHint = cur.team ? getTeamLabel(cur.team) : '';
  }

  function pushUndo(s: GameState) { setUndoStack(prev => [...prev.slice(-19), s]); }
  function applyState(next: GameState) { setState(next); syncUrl(next); }

  function sinkBall(ball: number) {
    if (state.phase !== 'playing' || state.sunkBalls.includes(ball)) return;
    pushUndo(state);
    let next = { ...state };
    if (shouldAssignTeams(state.gameType, state.teamAssigned, state.players, state.currentPlayerIndex, ball)) {
      next.players = assignTeams(state.players, state.currentPlayerIndex, ball);
      next.teamAssigned = true;
    }
    next.sunkBalls = [...next.sunkBalls, ball];
    const result = checkSinkResult(next.gameType, next.players, next.currentPlayerIndex, state.sunkBalls, ball);
    const entry: ShotLogEntry = {
      type: result.win ? 'win' : result.lose ? 'lose' : 'sink',
      playerName: cur.name, ball,
      timestamp: Date.now(), gameTime: Date.now() - state.gameStartTime,
      note: result.message || undefined,
    };
    if (result.win) {
      next.phase = 'ended'; next.winner = cur.name; next.winMessage = result.message;
    } else if (result.lose) {
      const winIdx = next.players.findIndex((_, i) => i !== next.currentPlayerIndex);
      next.phase = 'ended';
      next.winner = winIdx >= 0 ? next.players[winIdx].name : 'Opponent';
      next.winMessage = result.message;
    } else if (state.gameType === 'practice' && remaining.length === 1) {
      next.phase = 'ended'; next.winner = cur.name;
      next.winMessage = `Table cleared! Final BPM: ${finalBpm.toFixed(1)}`;
    }
    next.shotLog = [...next.shotLog, entry];
    applyState(next);
  }

  function turnAction(type: 'miss' | 'foul' | 'safety', note?: string) {
    if (state.phase !== 'playing') return;
    pushUndo(state);
    const nextIdx = (state.currentPlayerIndex + 1) % state.players.length;
    const entry: ShotLogEntry = {
      type, playerName: cur.name,
      timestamp: Date.now(), gameTime: Date.now() - state.gameStartTime, note,
    };
    applyState({ ...state, currentPlayerIndex: nextIdx, shotLog: [...state.shotLog, entry] });
  }

  function handleUndo() {
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(s => s.slice(0, -1));
    applyState(prev);
  }

  function handleShare() {
    navigator.clipboard.writeText(window.location.href)
      .then(() => { setToast('Copied!'); setTimeout(() => setToast(''), 2000); })
      .catch(() => { setToast('Copy URL from bar'); setTimeout(() => setToast(''), 3000); });
  }

  const modeLabel = state.gameType === 'practice' ? 'PRACTICE' : state.gameType.toUpperCase();

  return (
    <div className="app-window">
      {/* ── Title bar ── */}
      <div className="titlebar">
        <div className="titlebar-left">
          <span className="titlebar-icon">🎱</span>
          <span className="titlebar-title">BreakBPM · {modeLabel} · {state.shareCode}</span>
        </div>
        <div className="titlebar-btns">
          <button className="tb-btn">_</button>
          <button className="tb-btn">□</button>
          <button className="tb-btn" onClick={() => setConfirmNew(true)}>✕</button>
        </div>
      </div>

      {/* ── PC-98 Game Header ── */}
      <div className="splash-panel game-header-panel">
        {/* Left: logo */}
        <div className="splash-art-frame game-art-frame">
          <img src={ballImg} alt="8-ball" className="splash-ball-img game-ball-img" />
        </div>

        {/* Right: live stats */}
        <div className="game-stats-block">
          {/* Top row: mode + code */}
          <div className="game-stats-toprow">
            <span className="game-mode-badge">{modeLabel}</span>
            <div className="game-code-inline">
              <span className="game-code-val">{state.shareCode}</span>
              <button className="game-share-btn" onClick={handleShare} title="Copy share URL">
                {toast ? <span style={{ color: '#00ff41', fontSize: 9 }}>{toast}</span> : '📋'}
              </button>
            </div>
          </div>

          {/* BPM — big, dominant */}
          <div className="game-bpm-row">
            <div>
              <div className="game-bpm-val">{dispBpm.toFixed(1)}</div>
              <div className="game-bpm-unit">BPM</div>
            </div>
            <div className="game-bpm-divider" />
            <div>
              <div className="game-timer-val">{formatTime(dispTime)}</div>
              <div className="game-bpm-unit">TIME</div>
            </div>
            <div className="game-bpm-divider" />
            <div>
              <div className="game-count-val">{state.sunkBalls.length}</div>
              <div className="game-bpm-unit">SUNK</div>
            </div>
          </div>

          {/* Current player bar */}
          {state.phase === 'playing' && (
            <div className="game-cur-player">
              <span className="game-cur-arrow">▶</span>
              <span className="game-cur-name">{cur.name}</span>
              {cur.team && (
                <span className="game-cur-team">
                  {cur.team === 'solids' ? 'SOL' : 'STR'}
                </span>
              )}
              {state.gameType === '9ball' && (
                <span className="game-cur-hint">hit ({lowest9})</span>
              )}
            </div>
          )}
          {state.phase === 'ended' && (
            <div className="game-cur-player" style={{ background: '#1a1a00', borderColor: '#ffb300' }}>
              <span style={{ color: '#ffb300', fontFamily: 'VT323, monospace', fontSize: 16 }}>
                ★ {state.winner?.toUpperCase()} WINS
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="app-body">

        {/* WIN SCREEN */}
        {state.phase === 'ended' && (
          <div>
            <div className="win-banner">
              {state.winner ? `★ ${state.winner.toUpperCase()} WINS!` : 'GAME OVER'}
            </div>
            <div style={{ fontWeight: 'bold', color: '#000080', marginTop: 6, fontSize: 13 }}>
              {state.winMessage}
            </div>
            <div style={{ fontSize: 11, color: '#444', marginTop: 4, marginBottom: 8, fontFamily: 'Courier New, monospace' }}>
              FINAL BPM <strong>{finalBpm.toFixed(2)}</strong> &nbsp;·&nbsp;
              TIME <strong>{formatTime(Date.now() - state.gameStartTime)}</strong> &nbsp;·&nbsp;
              SUNK <strong>{state.sunkBalls.length}</strong>
            </div>
            <div className="grid-2">
              <button className="btn btn-primary btn-big" onClick={onNewGame}>▶ New Game</button>
              <button className="btn btn-big" onClick={handleShare}>📋 Share</button>
            </div>
          </div>
        )}

        {/* ── Players (multi-player, not practice) ── */}
        {state.gameType !== 'practice' && (
          <div>
            <div className="menu-section-label">▶ PLAYERS</div>
            <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
              {state.players.map((p, i) => {
                const active = i === state.currentPlayerIndex;
                const myGroup = p.team === 'solids' ? SOLIDS : p.team === 'stripes' ? STRIPES : [];
                const cleared = myGroup.length > 0 && myGroup.every(b => state.sunkBalls.includes(b));
                const mySunk = state.sunkBalls.filter(b => myGroup.includes(b)).length;
                return (
                  <div key={p.id} className={`player-card ${active ? 'player-card-active' : ''}`}>
                    <div className="player-card-name">
                      {active ? '▶ ' : ''}{p.name}
                    </div>
                    <div className="player-card-sub">
                      {p.team
                        ? <><span style={{ color: p.team === 'solids' ? '#4466ff' : '#cc8800' }}>
                            {p.team === 'solids' ? 'SOLIDS' : 'STRIPES'}
                          </span>{' '}{mySunk}/{myGroup.length}
                          {cleared && <span style={{ color: '#00ff41' }}> ✓</span>}
                        </>
                        : <span style={{ color: '#666' }}>TBD</span>
                      }
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Sunk balls terminal ── */}
        <div>
          <div className="menu-section-label">▶ SUNK BALLS
            <span style={{ fontWeight: 'normal', color: '#888', marginLeft: 6 }}>
              {state.sunkBalls.length} sunk{state.gameType !== 'practice' ? ` · ${remaining.length} left` : ''}
            </span>
          </div>
          <div className="terminal">
            {state.sunkBalls.length === 0
              ? <span className="terminal-dim">_ awaiting first shot...</span>
              : state.sunkBalls.map((b, i) => (
                <span key={i} style={{
                  color: b === 8 ? '#ffb300' : b === 9 ? '#ff6600' : '#00ff41',
                  fontWeight: 'bold',
                }}>
                  {ballLabel(b)}
                </span>
              ))
            }
          </div>
        </div>

        {/* ── Ball selector ── */}
        {state.phase !== 'ended' && (
          <div>
            <div className="menu-section-label">
              ▶ {state.gameType === 'practice' ? 'SELECT BALL' : `${cur.name.toUpperCase()}'S SHOT`}
              {selectorHint && (
                <span style={{ fontWeight: 'normal', color: '#888', marginLeft: 6 }}>{selectorHint}</span>
              )}
            </div>
            <div className="ball-grid">
              {allBalls.map(ball => (
                <button
                  key={ball}
                  className={ballClass(ball, legalBalls, state.sunkBalls, state.gameType)}
                  onClick={() => sinkBall(ball)}
                  style={{ fontSize: 13 }}
                >
                  ({ball})
                </button>
              ))}
            </div>
            {state.gameType === '8ball' && !state.teamAssigned && (
              <div className="notice" style={{ marginTop: 6 }}>
                <span>💡</span>
                <span style={{ fontSize: 11 }}>First ball sunk assigns Solids (1–7) or Stripes (9–15)</span>
              </div>
            )}
          </div>
        )}

        {/* ── Actions ── */}
        {state.phase === 'playing' && (
          <div>
            <div className="menu-section-label">▶ ACTIONS</div>
            <div className="action-grid">
              <button className="btn btn-big" onClick={() => turnAction('miss')}>↷ Miss</button>
              <button className="btn btn-big btn-danger" onClick={() => turnAction('foul', 'Ball in hand to opponent')}>⚠ Foul</button>
              <button className="btn btn-big" onClick={() => turnAction('safety', 'Safety — turn passes')}>🛡 Safety</button>
              <button className="btn btn-big" onClick={handleUndo} disabled={!undoStack.length}>↩ Undo</button>
            </div>
          </div>
        )}

        {/* ── Shot log (collapsible) ── */}
        <div>
          <button
            className="btn w-full"
            style={{ justifyContent: 'space-between', minHeight: 34, fontSize: 11, fontFamily: 'Courier New, monospace', letterSpacing: 1 }}
            onClick={() => setLogOpen(o => !o)}
          >
            <span>▶ SHOT LOG ({state.shotLog.length} entries)</span>
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

        {state.phase === 'playing' && (
          <button className="btn btn-danger w-full" style={{ fontSize: 11 }} onClick={() => setConfirmNew(true)}>
            ✖ End Game / New Game
          </button>
        )}
        {state.phase === 'ended' && (
          <button className="btn btn-primary btn-big w-full" onClick={onNewGame}>▶ New Game</button>
        )}

      </div>

      {/* ── Status bar ── */}
      <div className="statusbar">
        <div className="statusbar-item" style={{ flex: 2 }}>
          {state.phase === 'playing' ? `▶ ${cur.name}'s turn` : state.phase === 'ended' ? '■ Game Over' : '—'}
        </div>
        <div className="statusbar-item" style={{ flex: 1 }}>BPM: {dispBpm.toFixed(1)}</div>
        <div className="statusbar-item">{clock}</div>
      </div>

      {/* ── Confirm dialog ── */}
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
