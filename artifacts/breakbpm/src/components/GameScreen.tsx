import { useState, useEffect, useRef, useCallback } from 'react';
import { Win98Window, Win98Button, Win98StatusBar } from './Win98';
import type { GameState, ShotLogEntry } from '../lib/gameLogic';
import {
  getLegalBalls,
  getRemainingBalls,
  checkSinkResult,
  assignTeams,
  shouldAssignTeams,
  calculateBPM,
  formatTime,
  encodeGameState,
  generateShareCode,
  getTeamLabel,
  ballLabel,
  SOLIDS,
  STRIPES,
  EIGHT_BALL,
  getLowestBall,
} from '../lib/gameLogic';

interface GameScreenProps {
  initialState: GameState;
  onNewGame: () => void;
}

function getBallClass(ball: number, legalBalls: number[], sunkBalls: number[], gameType: string): string {
  if (sunkBalls.includes(ball)) return 'ball-btn ball-btn-sunk';
  const isLegal = legalBalls.includes(ball);
  if (ball === EIGHT_BALL) return `ball-btn ball-btn-8 ${isLegal ? 'ball-btn-legal' : 'ball-btn-illegal'}`;
  if (ball === 9 && gameType === '9ball') return `ball-btn ball-btn-9 ${isLegal ? 'ball-btn-legal' : 'ball-btn-illegal'}`;
  if (SOLIDS.includes(ball)) return `ball-btn ball-btn-solid ${isLegal ? 'ball-btn-legal' : 'ball-btn-illegal'}`;
  if (STRIPES.includes(ball)) return `ball-btn ball-btn-stripe ${isLegal ? 'ball-btn-legal' : 'ball-btn-illegal'}`;
  return `ball-btn ${isLegal ? 'ball-btn-legal' : 'ball-btn-illegal'}`;
}

export default function GameScreen({ initialState, onNewGame }: GameScreenProps) {
  const [state, setState] = useState<GameState>(initialState);
  const [elapsed, setElapsed] = useState(0);
  const [bpm, setBpm] = useState(0);
  const [shareToast, setShareToast] = useState('');
  const [undoStack, setUndoStack] = useState<GameState[]>([]);
  const [clockTime, setClockTime] = useState('');
  const [confirmNew, setConfirmNew] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update URL with game state
  const syncUrl = useCallback((s: GameState) => {
    try {
      const encoded = encodeGameState(s);
      const url = new URL(window.location.href);
      url.searchParams.set('state', encoded);
      url.searchParams.set('game', s.shareCode);
      window.history.replaceState(null, '', url.toString());
    } catch {}
  }, []);

  useEffect(() => {
    syncUrl(state);
  }, [state, syncUrl]);

  // Timer
  useEffect(() => {
    if (state.phase !== 'playing') return;
    timerRef.current = setInterval(() => {
      const now = Date.now();
      const e = now - state.gameStartTime;
      setElapsed(e);
      setBpm(calculateBPM(state.sunkBalls.length, state.gameStartTime));
    }, 500);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state.phase, state.gameStartTime, state.sunkBalls.length]);

  // System clock
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClockTime(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, []);

  // Scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [state.shotLog]);

  const currentPlayer = state.players[state.currentPlayerIndex];
  const remaining = getRemainingBalls(state.sunkBalls, state.gameType);
  const legalBalls = state.phase === 'playing'
    ? getLegalBalls(state.gameType, state.players, state.currentPlayerIndex, state.sunkBalls)
    : [];

  const allBalls = state.gameType === '9ball'
    ? [1, 2, 3, 4, 5, 6, 7, 8, 9]
    : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

  function addLog(entry: ShotLogEntry) {
    setState(prev => ({
      ...prev,
      shotLog: [...prev.shotLog, entry],
    }));
  }

  function sinkBall(ball: number) {
    if (state.phase !== 'playing') return;
    if (state.sunkBalls.includes(ball)) return;

    setUndoStack(prev => [...prev, state]);

    let nextState = { ...state };

    // Assign teams if needed (8-ball)
    if (shouldAssignTeams(state.gameType, state.teamAssigned, state.players, state.currentPlayerIndex, ball)) {
      nextState.players = assignTeams(state.players, state.currentPlayerIndex, ball);
      nextState.teamAssigned = true;
    }

    const newSunk = [...nextState.sunkBalls, ball];
    nextState.sunkBalls = newSunk;

    const result = checkSinkResult(
      nextState.gameType,
      nextState.players,
      nextState.currentPlayerIndex,
      state.sunkBalls,
      ball
    );

    const logEntry: ShotLogEntry = {
      type: result.win ? 'win' : result.lose ? 'lose' : 'sink',
      playerName: currentPlayer.name,
      ball,
      timestamp: Date.now(),
      gameTime: Date.now() - state.gameStartTime,
      note: result.message || undefined,
    };

    if (result.win) {
      nextState.phase = 'ended';
      nextState.winner = currentPlayer.name;
      nextState.winMessage = result.message;
    } else if (result.lose) {
      // Find other player (opponent wins)
      const loserIdx = nextState.currentPlayerIndex;
      const winnerIdx = nextState.players.findIndex((_, i) => i !== loserIdx);
      const winner = winnerIdx >= 0 ? nextState.players[winnerIdx] : null;
      nextState.phase = 'ended';
      nextState.winner = winner ? winner.name : 'Opponent';
      nextState.winMessage = result.message;
    }

    // Practice mode: no win/lose, just track
    if (state.gameType === 'practice' && remaining.length === 1) {
      nextState.phase = 'ended';
      nextState.winner = currentPlayer.name;
      nextState.winMessage = `${currentPlayer.name} cleared the table! Final BPM: ${calculateBPM(newSunk.length, state.gameStartTime).toFixed(1)}`;
    }

    nextState.shotLog = [...nextState.shotLog, logEntry];
    setState(nextState);
    syncUrl(nextState);
  }

  function recordFoul() {
    if (state.phase !== 'playing') return;
    setUndoStack(prev => [...prev, state]);

    const logEntry: ShotLogEntry = {
      type: 'foul',
      playerName: currentPlayer.name,
      timestamp: Date.now(),
      gameTime: Date.now() - state.gameStartTime,
      note: 'Foul — ball in hand to opponent',
    };

    const nextIdx = (state.currentPlayerIndex + 1) % state.players.length;
    setState(prev => ({
      ...prev,
      currentPlayerIndex: nextIdx,
      shotLog: [...prev.shotLog, logEntry],
    }));
  }

  function recordSafety() {
    if (state.phase !== 'playing') return;
    setUndoStack(prev => [...prev, state]);

    const logEntry: ShotLogEntry = {
      type: 'safety',
      playerName: currentPlayer.name,
      timestamp: Date.now(),
      gameTime: Date.now() - state.gameStartTime,
      note: 'Safety — turn passes',
    };

    const nextIdx = (state.currentPlayerIndex + 1) % state.players.length;
    setState(prev => ({
      ...prev,
      currentPlayerIndex: nextIdx,
      shotLog: [...prev.shotLog, logEntry],
    }));
  }

  function recordMiss() {
    if (state.phase !== 'playing') return;
    setUndoStack(prev => [...prev, state]);

    const logEntry: ShotLogEntry = {
      type: 'miss',
      playerName: currentPlayer.name,
      timestamp: Date.now(),
      gameTime: Date.now() - state.gameStartTime,
    };

    const nextIdx = (state.currentPlayerIndex + 1) % state.players.length;
    setState(prev => ({
      ...prev,
      currentPlayerIndex: nextIdx,
      shotLog: [...prev.shotLog, logEntry],
    }));
  }

  function handleUndo() {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(s => s.slice(0, -1));
    setState(prev);
    syncUrl(prev);
  }

  function handleShare() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setShareToast('URL copied to clipboard!');
      setTimeout(() => setShareToast(''), 2500);
    }).catch(() => {
      setShareToast(url);
      setTimeout(() => setShareToast(''), 5000);
    });
  }

  const finalBpm = state.gameType === 'practice' || state.phase === 'ended'
    ? calculateBPM(state.sunkBalls.length, state.gameStartTime)
    : bpm;

  const lowestBall9 = state.gameType === '9ball' ? getLowestBall(state.sunkBalls) : 0;

  return (
    <div className="app-root" style={{ paddingBottom: 40 }}>
      <div className="app-center">

        {/* Header */}
        <Win98Window title={`BreakBPM — ${state.gameType === 'practice' ? 'Practice Mode' : state.gameType.toUpperCase()} — Code: ${state.shareCode}`} icon="🎱">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>

            {/* BPM + Timer */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 90 }}>
              <div className="bpm-display">{state.phase === 'playing' ? bpm.toFixed(1) : finalBpm.toFixed(1)}</div>
              <div className="bpm-label">BALLS / MIN</div>
              <div className="timer-display" style={{ marginTop: 4 }}>
                {state.phase === 'playing' ? formatTime(elapsed) : formatTime(Date.now() - state.gameStartTime)}
              </div>
              <div className="bpm-label">ELAPSED</div>
            </div>

            {/* Terminal readout */}
            <div style={{ flex: 1, minWidth: 180 }}>
              <div className="terminal-label">SUNK BALLS LOG &gt;</div>
              <div className="terminal" style={{ minHeight: 64, fontSize: 14, letterSpacing: 0 }}>
                {state.sunkBalls.length === 0
                  ? <span style={{ color: '#006600' }}>_ awaiting first shot...</span>
                  : state.sunkBalls.map((b, i) => (
                    <span
                      key={i}
                      className={`terminal-ball ${b === 8 ? 'terminal-8ball' : b === 9 ? 'terminal-9ball' : ''}`}
                    >
                      {ballLabel(b)}
                    </span>
                  ))
                }
              </div>
              <div style={{ marginTop: 4, fontSize: 10, color: '#444' }}>
                {state.sunkBalls.length} ball{state.sunkBalls.length !== 1 ? 's' : ''} sunk
                {state.gameType !== 'practice' && ` · ${remaining.length} remaining`}
              </div>
            </div>

            {/* Share code */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', justifyContent: 'center', minWidth: 80 }}>
              <div style={{ fontSize: 10, color: '#444' }}>SHARE CODE</div>
              <div className="share-code">{state.shareCode}</div>
              <Win98Button onClick={handleShare} style={{ fontSize: 10, minWidth: 70 }}>
                📋 Copy URL
              </Win98Button>
              {shareToast && (
                <div style={{ fontSize: 9, color: '#006400', textAlign: 'center', maxWidth: 100, wordBreak: 'break-all' }}>
                  {shareToast}
                </div>
              )}
            </div>
          </div>
        </Win98Window>

        {/* Win/Ended screen */}
        {state.phase === 'ended' && (
          <Win98Window title="Game Over" style={{ marginTop: 8 }}>
            <div className="win-screen">
              <div className="win-banner">
                {state.winner ? `🏆 ${state.winner.toUpperCase()} WINS!` : 'GAME OVER'}
              </div>
              <div style={{ marginBottom: 12, fontSize: 13, color: '#000080', fontWeight: 'bold' }}>
                {state.winMessage}
              </div>
              <div style={{ fontSize: 11, marginBottom: 12, color: '#444' }}>
                Final BPM: <strong>{finalBpm.toFixed(2)}</strong> &nbsp;|&nbsp;
                Time: <strong>{formatTime(Date.now() - state.gameStartTime)}</strong> &nbsp;|&nbsp;
                Balls sunk: <strong>{state.sunkBalls.length}</strong>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <Win98Button variant="primary" onClick={onNewGame} style={{ fontSize: 13 }}>
                  ▶ New Game
                </Win98Button>
                <Win98Button onClick={handleShare}>
                  📋 Share Result
                </Win98Button>
              </div>
            </div>
          </Win98Window>
        )}

        {/* Players */}
        {state.phase !== 'ended' && state.gameType !== 'practice' && (
          <Win98Window title="Players" style={{ marginTop: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${state.players.length}, 1fr)`, gap: 6 }}>
              {state.players.map((player, i) => {
                const isCurrent = i === state.currentPlayerIndex;
                const myGroup = player.team === 'solids' ? SOLIDS : player.team === 'stripes' ? STRIPES : [];
                const mySunk = state.sunkBalls.filter(b => myGroup.includes(b));
                const myRemaining = myGroup.filter(b => !state.sunkBalls.includes(b));
                return (
                  <div key={player.id} className={`player-panel ${isCurrent ? 'active' : ''}`}>
                    <div className="player-name">
                      {isCurrent ? '▶ ' : ''}{player.name}
                    </div>
                    {state.gameType === '8ball' && (
                      <div className={player.team === 'solids' ? 'player-team-solid' : 'player-team-stripe'}>
                        {player.team ? getTeamLabel(player.team) : 'Team: TBD'}
                      </div>
                    )}
                    {player.team && (
                      <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>
                        {mySunk.length}/{myGroup.length} sunk
                        {myRemaining.length === 0 && <span style={{ color: '#006400', fontWeight: 'bold' }}> ✓ Clear!</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Win98Window>
        )}

        {/* Ball Selector */}
        {state.phase !== 'ended' && (
          <Win98Window
            title={
              state.gameType === 'practice'
                ? 'Ball Selector — Practice Mode'
                : state.gameType === '9ball'
                ? `Ball Selector — Hit (${lowestBall9}) first | Sink any on combo`
                : `Ball Selector — ${currentPlayer.name}'s turn (${currentPlayer.team ? getTeamLabel(currentPlayer.team) : 'team TBD'})`
            }
            style={{ marginTop: 8 }}
          >
            <div className="ball-grid">
              {allBalls.map(ball => {
                const sunk = state.sunkBalls.includes(ball);
                const isLegal = legalBalls.includes(ball);
                const cls = getBallClass(ball, legalBalls, state.sunkBalls, state.gameType);
                return (
                  <button
                    key={ball}
                    className={cls}
                    onClick={() => !sunk && isLegal && sinkBall(ball)}
                    disabled={sunk || !isLegal || state.phase !== 'playing'}
                    title={
                      sunk ? `Ball ${ball} already sunk` :
                      !isLegal ? `Ball ${ball} — not legal right now` :
                      `Sink ball ${ball}`
                    }
                  >
                    ({ball})
                  </button>
                );
              })}
            </div>

            {state.gameType === '8ball' && !state.teamAssigned && (
              <div className="win98-notice" style={{ margin: '4px 4px 0' }}>
                <span className="win98-notice-icon">💡</span>
                <span>First ball sunk determines team assignment (Solids 1-7 or Stripes 9-15)</span>
              </div>
            )}
          </Win98Window>
        )}

        {/* Action buttons */}
        {state.phase === 'playing' && (
          <Win98Window title="Actions" style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '2px 0' }}>
              <Win98Button onClick={recordMiss} title="Missed shot — next player's turn">
                ↷ Miss / Next Turn
              </Win98Button>
              <Win98Button onClick={recordFoul} variant="danger" title="Foul — ball in hand to opponent">
                ⚠ Foul
              </Win98Button>
              <Win98Button onClick={recordSafety} title="Safety shot — next player's turn">
                🛡 Safety
              </Win98Button>
              <Win98Button
                onClick={handleUndo}
                disabled={undoStack.length === 0}
                title="Undo last action"
              >
                ↩ Undo
              </Win98Button>
              <Win98Button
                variant="danger"
                onClick={() => setConfirmNew(true)}
                title="Start a new game"
                style={{ marginLeft: 'auto' }}
              >
                ✖ End Game
              </Win98Button>
            </div>
          </Win98Window>
        )}

        {/* Shot Log */}
        <Win98Window title="Shot Log" style={{ marginTop: 8 }}>
          <div className="terminal-label">SHOT HISTORY &gt;</div>
          <div className="shot-log" ref={logRef}>
            {state.shotLog.length === 0 && (
              <div style={{ color: '#006600' }}>_ no shots recorded yet...</div>
            )}
            {state.shotLog.map((entry, i) => {
              const t = formatTime(entry.gameTime);
              let line = '';
              if (entry.type === 'sink') line = `[${t}] ${entry.playerName} >> SINK ${ballLabel(entry.ball!)}`;
              else if (entry.type === 'foul') line = `[${t}] ${entry.playerName} >> FOUL`;
              else if (entry.type === 'safety') line = `[${t}] ${entry.playerName} >> SAFETY`;
              else if (entry.type === 'miss') line = `[${t}] ${entry.playerName} >> MISS`;
              else if (entry.type === 'win') line = `[${t}] ${entry.playerName} >> WIN! ${entry.ball ? ballLabel(entry.ball) : ''}`;
              else if (entry.type === 'lose') line = `[${t}] ${entry.playerName} >> LOSS`;
              return (
                <div key={i} className={`shot-log-entry ${entry.type}`}>
                  {line}{entry.note ? ` — ${entry.note}` : ''}
                </div>
              );
            })}
          </div>
        </Win98Window>

        {/* New Game button at bottom if ended */}
        {state.phase === 'ended' && (
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <Win98Button variant="primary" onClick={onNewGame} style={{ fontSize: 13 }}>
              ▶ New Game
            </Win98Button>
          </div>
        )}
      </div>

      {/* Confirm new game dialog */}
      {confirmNew && (
        <div className="win98-dialog-overlay" onClick={() => setConfirmNew(false)}>
          <div onClick={e => e.stopPropagation()}>
            <Win98Window title="BreakBPM" className="win98-dialog">
              <div style={{ padding: '8px 0', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 32 }}>⚠</span>
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: 6 }}>End current game?</div>
                  <div style={{ fontSize: 11, color: '#444' }}>
                    The current game will be lost. Are you sure you want to start a new game?
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
                <Win98Button variant="primary" onClick={onNewGame}>Yes</Win98Button>
                <Win98Button onClick={() => setConfirmNew(false)}>No</Win98Button>
              </div>
            </Win98Window>
          </div>
        </div>
      )}

      {/* Taskbar */}
      <div className="win98-taskbar">
        <button className="win98-start-btn">
          <span>⊞</span> Start
        </button>
        <Win98Button style={{ minWidth: 'unset', padding: '1px 8px', fontSize: 10, height: 22 }}>
          🎱 BreakBPM
        </Win98Button>
        <div className="win98-clock">{clockTime}</div>
      </div>

      <Win98StatusBar
        items={[
          state.phase === 'playing' ? `▶ Playing` : state.phase === 'ended' ? '■ Game Over' : '...',
          state.gameType.toUpperCase(),
          `BPM: ${bpm.toFixed(1)}`,
          `Balls: ${state.sunkBalls.length}`,
          `Code: ${state.shareCode}`,
        ]}
      />
    </div>
  );
}
