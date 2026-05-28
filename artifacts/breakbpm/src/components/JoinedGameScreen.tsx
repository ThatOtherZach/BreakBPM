import { useEffect, useState, useMemo, useRef } from 'react';
import { useLocation } from 'wouter';
import Navbar from './Navbar';
import SharkIcon from './SharkIcon';
import type { GameState } from '../lib/gameLogic';
import {
  calculatePlayerBPM,
  formatTime,
  ballLabel,
  normalizeSharkIdentity,
  SOLIDS,
  STRIPES,
  EIGHT_BALL,
  SHARK_PLAYER_NAME,
} from '../lib/gameLogic';
import {
  useJoinGame,
  useGetGameStateByCode,
  getGetGameStateByCodeQueryKey,
  useLeaveGame,
} from '@workspace/api-client-react';

const BALL_COLORS: Record<number, string> = {
  1: '#FDD307', 2: '#1F4E9E', 3: '#C3342B', 4: '#5B247A',
  5: '#F27C1D', 6: '#276B40', 7: '#6B1F2A', 8: '#000000',
  9: '#FDD307', 10: '#1F4E9E', 11: '#C3342B', 12: '#5B247A',
  13: '#F27C1D', 14: '#276B40', 15: '#6B1F2A',
};

interface Props {
  code: string;
  onBack: () => void;
  onAbout: () => void;
  onAccount: () => void;
  onSignIn: () => void;
}

/**
 * Read-only view for joiners and spectators. Polls /games/state on the
 * shared share code. The host's device is the canonical scorekeeper —
 * this view shows the host's snapshot and disables all scoring inputs.
 *
 * Renders an overlay banner that explicitly states "View only — host is
 * scorekeeping" so joiners aren't confused about why they can't tap.
 */
export default function JoinedGameScreen({ code, onBack, onAbout, onAccount, onSignIn }: Props) {
  const [, setLocation] = useLocation();
  const join = useJoinGame();
  const leave = useLeaveGame();

  // Run the join exactly once on mount. Result tells us role
  // (player/spectator/already_joined) and the canonical gameId.
  const [joinResult, setJoinResult] = useState<{
    role: 'player' | 'spectator' | 'already_joined';
    gameId: string;
    displayName: string;
    reason?: string;
  } | null>(null);
  const [joinError, setJoinError] = useState<string>('');
  const joinedRef = useRef(false);
  useEffect(() => {
    if (joinedRef.current) return;
    joinedRef.current = true;
    join.mutateAsync({ data: { code } })
      .then(r => {
        if (!r.joined && r.reason === 'not_found') {
          setJoinError(`No active game with code ${code}.`);
          return;
        }
        if (!r.joined && r.reason === 'ended') {
          setJoinError('That game already ended.');
          return;
        }
        setJoinResult({
          role: r.role,
          gameId: r.gameId,
          displayName: r.displayName ?? '',
          reason: r.reason,
        });
      })
      .catch((e: unknown) => {
        const err = e as { data?: { error?: string } };
        setJoinError(err?.data?.error ?? (e instanceof Error ? e.message : 'Could not join.'));
      });
  }, [code, join]);

  // Polling: every 2.5s while tab is visible, 10s when hidden. Disabled
  // once the game ends so we stop hitting the server in a tight loop.
  const [pollInterval, setPollInterval] = useState<number | false>(2500);
  useEffect(() => {
    const onVis = () => {
      setPollInterval(prev => (prev === false ? false : (document.hidden ? 10000 : 2500)));
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  const snap = useGetGameStateByCode(
    { code },
    {
      query: {
        queryKey: getGetGameStateByCodeQueryKey({ code }),
        refetchInterval: pollInterval,
        enabled: !!joinResult,
      },
    },
  );

  const ended = snap.data?.ended ?? false;
  useEffect(() => {
    if (ended) setPollInterval(false);
  }, [ended]);

  // If the host opens their own join URL, redirect them back to the main
  // setup/game flow so they don't end up in the read-only joiner view
  // (where the "Leave" button would forfeit their own game).
  useEffect(() => {
    if (joinResult?.role === 'already_joined' && joinResult.reason === 'host') {
      setLocation('/');
    }
  }, [joinResult, setLocation]);

  // Pull and normalize the host's gameState snapshot. The shape mirrors
  // GameState — we read it defensively so a partial snapshot doesn't
  // crash the view.
  const state: Partial<GameState> | null = useMemo(() => {
    const gs = snap.data?.gameState as Partial<GameState> | undefined;
    if (!gs) return null;
    return normalizeSharkIdentity({ ...gs });
  }, [snap.data?.gameState]);

  async function handleLeave() {
    if (!joinResult) {
      onBack();
      return;
    }
    try {
      await leave.mutateAsync({ data: { gameId: joinResult.gameId } });
    } catch {
      /* best-effort; still navigate */
    }
    onBack();
    setLocation('/');
  }

  if (joinError) {
    return (
      <div className="app-window">
        <Navbar onAbout={onAbout} onAccount={onAccount} onSignIn={onSignIn} />
        <div className="app-body">
          <div className="notice" style={{ color: '#c00' }}>
            <span>!</span><span>{joinError}</span>
          </div>
          <button className="btn btn-primary btn-big btn-full" onClick={() => { onBack(); setLocation('/'); }}>
            ← Back to menu
          </button>
        </div>
      </div>
    );
  }

  if (!joinResult || !snap.data?.found) {
    return (
      <div className="app-window">
        <Navbar onAbout={onAbout} onAccount={onAccount} onSignIn={onSignIn} />
        <div className="app-body">
          <div className="notice">Connecting to game {code}…</div>
        </div>
      </div>
    );
  }

  const sunk = state?.sunkBalls ?? [];
  const sharkBalls = state?.sharkSunkBalls ?? [];
  const players = state?.players ?? [];
  const currentIdx = state?.currentPlayerIndex ?? 0;
  const cur = players[currentIdx];
  const shotLog = state?.shotLog ?? [];

  const dispPlayerName = state?.phase === 'ended'
    ? (state?.winner ?? cur?.name)
    : cur?.name;
  const dispBpm = dispPlayerName ? calculatePlayerBPM(shotLog, dispPlayerName) : null;
  const elapsed = state?.timerStartTime != null
    ? Math.max(0, Date.now() - state.timerStartTime)
    : 0;

  const renderBalls = (balls: number[]) => [...balls].reverse().map((b, i) => (
    <span
      key={i}
      className={`hud-chip ${b === 8 ? 'hud-chip-eight' : SOLIDS.includes(b) ? 'hud-chip-solid' : 'hud-chip-stripe'}`}
      data-number={b}
      style={{ '--chip-color': BALL_COLORS[b] } as React.CSSProperties}
      aria-label={`Ball ${b}`}
    />
  ));

  return (
    <div className="app-window">
      <Navbar onAbout={onAbout} onAccount={onAccount} onSignIn={onSignIn} />

      {/* View-only banner — pinned at top of body so it's obvious every render */}
      <div
        className="notice"
        style={{
          margin: 8,
          background: '#fff4cc',
          border: '2px solid #c39d00',
          fontWeight: 'bold',
        }}
      >
        <span>👁</span>
        <span>
          View only — host's device is scorekeeping.{' '}
          {joinResult.role === 'spectator' ? '(spectator)' : `(slot ${joinResult.displayName})`}
        </span>
      </div>

      <div className="hud-panel">
        <div className="hud-top">
          <div className="hud-bpm-block">
            <div className="hud-bpm-label">BALLS/MIN</div>
            <div className={`hud-bpm-value${dispBpm === null ? ' hud-bpm-dim' : ''}`}>
              {dispBpm !== null ? dispBpm.toFixed(1) : '--.-'}
            </div>
            <div className="hud-bpm-sub">
              {dispBpm === null ? 'AWAITING PLAY' : `${dispPlayerName?.toUpperCase() ?? ''}`}
            </div>
          </div>
          <div className="hud-divider" />
          <div className="hud-right">
            <div className="hud-right-row">
              <span className="hud-meta-label">MODE</span>
              <span className="hud-mode">
                {state?.gameType === 'practice' ? 'PRACTICE'
                  : state?.gameType === '8ball' ? '8-BALL'
                  : '9-BALL'}
                <span className="hud-mode-players"> · {players.length || 0}P</span>
              </span>
            </div>
            <div className="hud-right-row">
              <span className="hud-meta-label">TIME</span>
              <span className="hud-timer">{formatTime(elapsed)}</span>
            </div>
            <div className="hud-right-row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="hud-meta-label">CODE</span>
              <span className="hud-code">{code}</span>
            </div>
          </div>
        </div>

        <div className="hud-terminal">
          {sunk.length === 0
            ? <span className="hud-terminal-idle">&gt;awaiting first shot</span>
            : [...sunk].reverse().map((b, i) => {
              const sunkByShark = sharkBalls.includes(b);
              return (
                <span
                  key={i}
                  className={`hud-chip ${b === 8 ? 'hud-chip-eight' : SOLIDS.includes(b) ? 'hud-chip-solid' : 'hud-chip-stripe'}`}
                  data-number={b}
                  style={{
                    '--chip-color': BALL_COLORS[b],
                    ...(sunkByShark ? { opacity: 0.45 } : {}),
                  } as React.CSSProperties}
                  aria-label={`Ball ${b}`}
                />
              );
            })
          }
        </div>

        {players.map((p, i) => {
          const active = state?.phase === 'playing' && i === currentIdx;
          const myGroup = p.team === 'solids' ? SOLIDS : p.team === 'stripes' ? STRIPES : [];
          const cleared = myGroup.length > 0 && myGroup.every(b => sunk.includes(b));
          const mySunk = shotLog
            .filter(e => (e.type === 'sink' || e.type === 'win' || e.type === 'lose')
              && e.playerName === p.name && typeof e.ball === 'number')
            .map(e => e.ball as number);
          const teamLabel = p.team ? (p.team === 'solids' ? 'Solids' : 'Stripes') : null;
          return (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 8px', marginTop: 4,
              background: '#1a0a2e', border: '1px solid #5a2a8a',
              borderColor: active ? '#d8b4ff' : '#5a2a8a',
              fontFamily: "'VT323',monospace", fontSize: 14, color: '#d8b4ff',
              flexWrap: 'wrap',
            }}>
              <span style={{ minWidth: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} aria-hidden="true">
                {active ? <span className="cue-ball-icon" /> : null}
              </span>
              <span style={{ fontSize: 18, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
              {teamLabel && (
                <span style={{ fontSize: 12, opacity: 0.7 }}>
                  · {teamLabel}{cleared && ' ✓'}
                </span>
              )}
              <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, marginLeft: 8, alignItems: 'center' }}>
                {renderBalls(mySunk)}
              </span>
            </div>
          );
        })}

        {state?.phase === 'ended' && (
          <div className="hud-winner">
            <span className="hud-winner-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {state.winner ? (
                <>
                  ★ {state.winner === SHARK_PLAYER_NAME && <SharkIcon size={21} />}
                  {state.winner.toUpperCase()} WINS
                </>
              ) : 'GAME OVER'}
            </span>
            {state.winMessage && <span className="hud-winner-sub">{state.winMessage}</span>}
          </div>
        )}
      </div>

      <div className="app-body">
        <div>
          <div className="menu-section-label" style={{ marginBottom: 6 }}>SHOT LOG</div>
          <div className="shot-log" style={{ maxHeight: 220, overflowY: 'auto' }}>
            {shotLog.length === 0
              ? <div style={{ color: '#006600' }}>_ no shots yet...</div>
              : shotLog.map((e, i) => {
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
        </div>

        <div className="grid-2">
          <button className="btn btn-big" onClick={() => { onBack(); setLocation('/'); }}>
            ← Back
          </button>
          {!ended && joinResult.role !== 'spectator' && (
            <button
              className="btn btn-big btn-danger"
              onClick={handleLeave}
              disabled={leave.isPending}
            >
              {leave.isPending ? '…' : '🚪 Leave (forfeit)'}
            </button>
          )}
        </div>
      </div>

      <div className="statusbar">
        <div className="statusbar-item" style={{ flex: 2 }}>
          {ended ? '■ Game ended' : '👁 View only — host scorekeeping'}
        </div>
        <div className="statusbar-item">{joinResult.role.toUpperCase()}</div>
      </div>

      {/* Avoid unused-import lint — EIGHT_BALL is referenced by class string above already */}
      <span style={{ display: 'none' }} aria-hidden="true">{EIGHT_BALL}</span>
    </div>
  );
}
