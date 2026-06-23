import { useEffect, useState, useMemo, useRef } from 'react';
import { useLocation } from 'wouter';
import Navbar from './Navbar';
import SharkIcon from './SharkIcon';
import type { GameState } from '../lib/gameLogic';
import {
  calculatePlayerBPM,
  calculatePlayerAccuracy,
  playerAccuracyCounts,
  formatTime,
  ballLabel,
  normalizeSharkIdentity,
  getAllBalls,
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
import { ObsIdle, W98Frame } from './ObsOverlay';
import { PlayerName } from './PlayerName';
import { useAuth } from '../lib/authClient';
import { THEME_FELT, THEME_ACCENT, themeColorOf } from '../lib/backgroundVariants';

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
  /**
   * View-only intent. Set by the persistent /watch/{name} link so the join
   * call never claims a player slot — the server short-circuits to the
   * read-only spectator role. When true we also skip the guestToken dance
   * (no slot to reserve / forfeit), so a watcher never occupies a seat.
   */
  spectatorOnly?: boolean;
  /**
   * OBS overlay mode. Renders ONLY the HUD panel on a transparent background
   * with no navbar/back/status chrome, so it can be dropped into OBS as a
   * Browser Source. Idle/ended/unpaid-host/error states collapse to a single
   * `:(` face — never an error card or sign-in UI.
   */
  obs?: boolean;
  /** Also render a compact (few-line) shot log below the overlay HUD. */
  obsLog?: boolean;
  /** CSS transform scale applied to the whole overlay. */
  obsScale?: number;
  /** The public watch handle (/watch/{name}) — shown in the OBS widget title bar. */
  watchName?: string;
}

/**
 * Read-only view for joiners and spectators. Polls /games/state on the
 * shared share code. The host's device is the canonical scorekeeper —
 * this view shows the host's snapshot and disables all scoring inputs.
 *
 * Renders an overlay banner that explicitly states "View only — host is
 * scorekeeping" so joiners aren't confused about why they can't tap.
 */
export default function JoinedGameScreen({ code, onBack, onAbout, onAccount, onSignIn, spectatorOnly = false, obs = false, obsLog = false, obsScale = 1, watchName }: Props) {
  const [, setLocation] = useLocation();
  const join = useJoinGame();
  const leave = useLeaveGame();

  // Run the join exactly once on mount. Result tells us role
  // (player/spectator/already_joined) and the canonical gameId.
  // For guest joiners we also receive a `guestToken` — stash it in
  // localStorage so a tab-refresh re-uses the same slot instead of
  // claiming a new one, and so /games/leave can authenticate.
  const [joinResult, setJoinResult] = useState<{
    role: 'player' | 'spectator' | 'already_joined';
    gameId: string;
    displayName: string;
    reason?: string;
    slotIndex: number | null;
    guestToken: string | null;
  } | null>(null);
  const [joinError, setJoinError] = useState<string>('');
  const joinedRef = useRef(false);
  const guestTokenKey = `breakbpm.guestToken:${code}`;
  useEffect(() => {
    if (joinedRef.current) return;
    joinedRef.current = true;
    // Replay any guestToken stored from a prior join on this device so
    // the server can short-circuit to our existing slot (idempotent
    // rejoin) instead of allocating a new one on tab refresh. Skipped
    // for view-only watchers — they never reserve a slot, so there is no
    // token to replay and we must not appear to claim one.
    let storedToken: string | null = null;
    if (!spectatorOnly) {
      try { storedToken = localStorage.getItem(guestTokenKey); } catch { /* noop */ }
    }
    join.mutateAsync({
      data: {
        code,
        ...(spectatorOnly ? { spectatorOnly: true } : {}),
        ...(storedToken ? { guestToken: storedToken } : {}),
      },
    })
      .then(r => {
        if (!r.joined && r.reason === 'not_found') {
          setJoinError(`No active game with code ${code}.`);
          return;
        }
        if (!r.joined && r.reason === 'ended') {
          setJoinError('That game already ended.');
          return;
        }
        if (!r.joined && r.reason === 'rate_limited') {
          setJoinError('Too many join attempts. Please wait a minute and try again.');
          return;
        }
        if (!r.joined && r.reason === 'spectators_disabled') {
          setJoinError("Watching isn't available for this game — the host doesn't have an active pass.");
          return;
        }
        if (!r.joined) {
          setJoinError(`Could not join game ${code}.`);
          return;
        }
        let token: string | null = (r as { guestToken?: string | null }).guestToken ?? null;
        try {
          if (token) {
            localStorage.setItem(guestTokenKey, token);
          } else {
            // Restore a token from a previous join on this device so
            // /games/leave can still authenticate after a refresh.
            token = localStorage.getItem(guestTokenKey);
          }
        } catch { /* storage unavailable */ }
        setJoinResult({
          role: r.role,
          gameId: r.gameId,
          displayName: r.displayName ?? '',
          reason: r.reason,
          slotIndex: (r as { slotIndex?: number | null }).slotIndex ?? null,
          guestToken: token,
        });
      })
      .catch((e: unknown) => {
        const err = e as { data?: { error?: string } };
        setJoinError(err?.data?.error ?? (e instanceof Error ? e.message : 'Could not join.'));
      });
  }, [code, join, guestTokenKey, spectatorOnly]);

  // Polling cadence, tiered by audience to keep idle DB load down:
  //  - signed-in watchers get the snappiest updates (2s)
  //  - anonymous watchers poll at 4s
  //  - OBS overlays (commonly left running unattended 24/7) are pinned to the
  //    slow 4s bucket regardless of sign-in
  // Hidden tabs back off to 10s; polling stops entirely once the game ends.
  const { isAuthenticated } = useAuth();
  const activeMs = obs ? 4000 : isAuthenticated ? 2000 : 4000;
  const [pollInterval, setPollInterval] = useState<number | false>(
    typeof document !== 'undefined' && document.hidden ? 10000 : activeMs,
  );
  useEffect(() => {
    const apply = () => {
      setPollInterval(prev => (prev === false ? false : (document.hidden ? 10000 : activeMs)));
    };
    // Apply immediately so an auth-state change after mount (e.g. /auth/me
    // resolving) re-tiers the live interval without waiting for a visibility
    // toggle, then keep it in sync with tab visibility.
    apply();
    document.addEventListener('visibilitychange', apply);
    return () => document.removeEventListener('visibilitychange', apply);
  }, [activeMs]);
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
  //
  // EXCEPT in OBS overlay mode: a streamer who is the host legitimately opens
  // their own /watch/:name?obs=1 to pipe the HUD into OBS. The overlay has no
  // Leave button (nothing to forfeit) and redirecting would dump the full app
  // chrome onto their stream — so stay on the overlay and render the HUD.
  useEffect(() => {
    if (!obs && joinResult?.role === 'already_joined' && joinResult.reason === 'host') {
      setLocation('/');
    }
  }, [obs, joinResult, setLocation]);

  // Pull and normalize the host's gameState snapshot. The shape mirrors
  // GameState — we read it defensively so a partial snapshot doesn't
  // crash the view.
  const state: Partial<GameState> | null = useMemo(() => {
    const gs = snap.data?.gameState as Partial<GameState> | undefined;
    if (!gs) return null;
    return normalizeSharkIdentity({ ...gs });
  }, [snap.data?.gameState]);

  // Local 1s tick so the elapsed clock advances smoothly between polls
  // instead of jumping each time a fresh snapshot lands. `elapsed` is
  // derived from the host's `timerStartTime` anchor and the live local
  // clock, so every tick re-anchors to the host and there is no drift
  // beyond constant device clock skew. Stops once the game ends or before
  // the first ball drops (no timer running yet).
  const [, setNowTick] = useState(0);
  const timerRunning = !(snap.data?.ended ?? false)
    && state?.phase === 'playing'
    && state?.timerStartTime != null;
  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => setNowTick(n => (n + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  async function handleLeave() {
    if (!joinResult) {
      onBack();
      return;
    }
    try {
      await leave.mutateAsync({
        data: {
          gameId: joinResult.gameId,
          ...(joinResult.guestToken ? { guestToken: joinResult.guestToken } : {}),
        },
      });
      try { localStorage.removeItem(guestTokenKey); } catch { /* noop */ }
    } catch {
      /* best-effort; still navigate */
    }
    onBack();
    setLocation('/');
  }

  if (joinError) {
    // In overlay mode every failure (not found, ended, rate-limited, or the
    // host lacking an active paid pass) collapses to the `:(` face — never an
    // error card or Back button on stream.
    if (obs) return <ObsIdle scale={obsScale} />;
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
    // Brief connecting window: show `:(` in overlay mode rather than a
    // "Connecting…" notice with app chrome.
    if (obs) return <ObsIdle scale={obsScale} />;
    return (
      <div className="app-window">
        <Navbar onAbout={onAbout} onAccount={onAccount} onSignIn={onSignIn} />
        <div className="app-body">
          <div className="notice">Connecting to game {code}…</div>
        </div>
      </div>
    );
  }

  // Tint the view-only HUD felt to the host's profile theme so spectators see
  // the same themed table the host does. The host's resolved theme rides the
  // /games/state snapshot; map it through the shared THEME_FELT table (shark →
  // blue, hustler → red, else the default green).
  const themeColor = themeColorOf(snap.data?.hostTheme);
  const felt = THEME_FELT[themeColor];

  // Carry the host's theme accent into the per-player scoreboard rows so the
  // whole spectator HUD reads as one themed surface (matching the felt above).
  // No theme (green) keeps the original purple scoreboard look; any real theme
  // tints the row borders + active highlight to its shared THEME_ACCENT.
  const board = themeColor === 'green'
    ? { border: '#5a2a8a', activeBorder: '#d8b4ff', text: '#d8b4ff' }
    : { border: `${THEME_ACCENT[themeColor]}80`, activeBorder: THEME_ACCENT[themeColor], text: THEME_ACCENT[themeColor] };

  const sunk = state?.sunkBalls ?? [];
  // Practice can use the 8-ball (1–15) or 9-ball (1–9) rack; every other mode's
  // rack is fixed by game type. Default to the 8-ball rack when no state yet.
  const allBalls = state?.gameType
    ? getAllBalls(state.gameType, state.practiceRack)
    : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const sharkBalls = state?.sharkSunkBalls ?? [];
  const players = state?.players ?? [];
  // Server roster (source of truth for who currently holds each slot).
  // Joiners that arrive after the host started will appear here even
  // before the host's local gameState reflects them, so the joiner view
  // can always show "who's actually in this game right now".
  const participants = (snap.data as { participants?: Array<{
    slotIndex: number;
    displayName: string;
    isHost: boolean;
    hasLeft: boolean;
    isGuest: boolean;
    rainbowName: boolean;
  }> } | undefined)?.participants ?? [];
  const rosterBySlot = new Map(participants.map(p => [p.slotIndex, p]));
  // Set of rainbow-name display names (resolved server-side, carried only in
  // the participants payload) used to rainbow matching names in the HUD/shot log.
  const rainbowNames = new Set(participants.filter(p => p.rainbowName).map(p => p.displayName));
  const isRainbowName = (name: string | null | undefined): boolean => !!name && rainbowNames.has(name);
  const currentIdx = state?.currentPlayerIndex ?? 0;
  const cur = players[currentIdx];
  // The host is always Player 1 (slot 0). Prefer the live roster name,
  // falling back to the snapshot's player name.
  const hostName = rosterBySlot.get(0)?.displayName ?? players[0]?.name ?? 'Player 1';
  const shotLog = state?.shotLog ?? [];

  // View-only notice, shown as the first entry in the shot log (the first
  // message a joiner/spectator sees) instead of a pinned banner.
  const viewNotice =
    joinResult.reason === 'in_progress'
      ? `Game already underway — viewing as spectator. ${hostName} is host.`
      : joinResult.reason === 'full'
        ? `Last slot was just taken — viewing as spectator. ${hostName} is host.`
        : `View only — ${hostName}'s device is host.${joinResult.role === 'spectator' ? ' (spectator)' : ''}`;

  const dispPlayerName = state?.phase === 'ended'
    ? (state?.winner ?? cur?.name)
    : cur?.name;
  const dispBpm = dispPlayerName ? calculatePlayerBPM(shotLog, dispPlayerName) : null;
  // Accuracy mirrors BPM exactly: same display-player (current shooter, or
  // winner once the game has ended).
  const dispAcc = dispPlayerName ? calculatePlayerAccuracy(shotLog, dispPlayerName) : null;
  const dispAccCounts = dispPlayerName ? playerAccuracyCounts(shotLog, dispPlayerName) : null;
  // Once the game has ended, freeze the elapsed clock on the game's true
  // final duration — the largest relative game-time stamped on the shot log
  // (the terminal entry) — instead of letting it drift forward against the
  // wall clock on every poll. The host's own HUD freezes the same way, so
  // this keeps the spectator's final time in lockstep with the host's.
  const gameOver = ended || state?.phase === 'ended';
  const finalGameTime = shotLog.reduce(
    (max, e) => (typeof e.gameTime === 'number' && e.gameTime > max ? e.gameTime : max),
    0,
  );
  const elapsed = gameOver
    ? finalGameTime
    : state?.timerStartTime != null
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

  const rackChip = (b: number) => {
    const isSunk = sunk.includes(b);
    const sunkByShark = sharkBalls.includes(b);
    return (
      <span
        key={b}
        className={`hud-chip ${b === EIGHT_BALL ? 'hud-chip-eight' : SOLIDS.includes(b) ? 'hud-chip-solid' : 'hud-chip-stripe'}${isSunk ? ' hud-chip-sunk' : ''}`}
        data-number={b}
        style={{ '--chip-color': BALL_COLORS[b] } as React.CSSProperties}
        title={sunkByShark ? 'Sunk by the Shark' : undefined}
        aria-label={`Ball ${b}${isSunk ? ' (sunk)' : ''}`}
      />
    );
  };

  const hudPanel = (
    <div className="hud-panel">
        <div className="hud-top">
          <div className="hud-bpm-block">
            <div className="hud-bpm-label">BALLS/MIN</div>
            <div className={`hud-bpm-value${dispBpm === null ? ' hud-bpm-dim' : ''}`}>
              {dispBpm !== null ? dispBpm.toFixed(1) : '--.-'}
            </div>
            <div className="hud-bpm-sub">
              {dispBpm === null
                ? 'AWAITING PLAY'
                : <PlayerName name={dispPlayerName ?? ''} rainbow={isRainbowName(dispPlayerName)} upper />}
            </div>
          </div>
          <div className="hud-divider" />
          {/* Accuracy — twin hero number, equal weight to BPM */}
          <div className="hud-bpm-block">
            <div className="hud-bpm-label">ACCURACY</div>
            <div className={`hud-bpm-value${dispAcc === null ? ' hud-bpm-dim' : ''}`}>
              {dispAcc !== null ? `${dispAcc}%` : '--%'}
            </div>
            <div className="hud-bpm-sub text-[#00ff41]">
              {dispAcc === null || dispAccCounts === null
                ? 'AWAITING PLAY'
                : `${dispAccCounts.made}/${dispAccCounts.attempts} MADE`}
            </div>
          </div>
          <div className="hud-divider" />
          <div className="hud-right">
            <div className="hud-right-row">
              <span className="hud-meta-label">TIME</span>
              <span className="hud-timer">{formatTime(elapsed)}</span>
            </div>
            <div className="hud-right-row">
              <span className="hud-meta-label">MODE</span>
              <span className="hud-mode">
                {state?.gameType === 'practice' ? 'PRACTICE'
                  : state?.gameType === '8ball' ? '8-BALL'
                  : '9-BALL'}
                <span className="hud-mode-players"> · {players.length || 0}P</span>
              </span>
              <span
                style={{ display: 'inline-flex', alignItems: 'center', color: '#ff5fb4' }}
                title={viewNotice}
                role="img"
                aria-label={viewNotice}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </span>
            </div>
          </div>
        </div>

        {/* Rack tray — mirrors the host HUD: in 8-ball (and the 8-ball
            practice rack) the rack clusters solids on the left and stripes on
            the right with the 8-ball centered between them; 9-ball (and the
            9-ball practice rack) shows a single line of 1–9.
            A ball drains to an empty socket once it's pocketed. */}
        <div
          className="hud-terminal"
          style={{ '--felt-color': felt.felt, '--felt-shadow': felt.feltShadow } as React.CSSProperties}
        >
          {state?.gameType === '9ball' || (state?.gameType === 'practice' && state?.practiceRack === '9ball') ? (
            <div className="rack-line">{allBalls.map(rackChip)}</div>
          ) : (
            <div className="rack-grouped">
              <div className="rack-side">{SOLIDS.map(rackChip)}</div>
              <div className="rack-eight">{rackChip(EIGHT_BALL)}</div>
              <div className="rack-side">{STRIPES.map(rackChip)}</div>
            </div>
          )}
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
          // Overlay server roster: prefer roster displayName + show "(left)"
          // when a joiner has bailed but the slot is still reserved.
          const roster = rosterBySlot.get(i);
          const shownName = roster?.displayName ?? p.name;
          const isMe = joinResult?.slotIndex === i;
          return (
            <div key={p.id} style={{
              display: 'flex', flexDirection: 'column', gap: 2,
              padding: '3px 8px', marginTop: 3,
              background: '#1a0a2e', border: `1px solid ${board.border}`,
              borderColor: active ? board.activeBorder : board.border,
              fontFamily: "'VT323',monospace", fontSize: 14, color: board.text,
              opacity: roster?.hasLeft ? 0.55 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ minWidth: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} aria-hidden="true">
                  {active ? <span className="cue-ball-icon" /> : null}
                </span>
                <span style={{ fontSize: 16, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <PlayerName name={shownName} rainbow={roster?.rainbowName ?? isRainbowName(shownName)} />{isMe ? ' (you)' : ''}{roster?.isHost ? ' ★' : ''}
                </span>
                {roster?.hasLeft && (
                  <span style={{ fontSize: 12, color: '#ff9090' }}>· left</span>
                )}
                {teamLabel && (
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    · {teamLabel}{cleared && ' ✓'}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minHeight: 26 }}>
                {renderBalls(mySunk)}
              </div>
            </div>
          );
        })}

        {/* Late joiners: server roster slots not yet reflected in the host's
            local gameState.players[] (host hasn't refreshed). Show them so
            joiners always see the real roster. */}
        {participants
          .filter(rp => rp.slotIndex >= players.length)
          .map(rp => (
            <div key={`roster-${rp.slotIndex}`} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 8px', marginTop: 4,
              background: '#1a0a2e', border: `1px dashed ${board.border}`,
              fontFamily: "'VT323',monospace", fontSize: 14, color: board.text,
              opacity: rp.hasLeft ? 0.55 : 0.9,
            }}>
              <span style={{ minWidth: 12 }} aria-hidden="true" />
              <span style={{ fontSize: 18 }}>
                <PlayerName name={rp.displayName} rainbow={rp.rainbowName} />{joinResult?.slotIndex === rp.slotIndex ? ' (you)' : ''}
              </span>
              <span style={{ fontSize: 12, opacity: 0.7 }}>· joining…</span>
              {rp.hasLeft && <span style={{ fontSize: 12, color: '#ff9090' }}>· left</span>}
            </div>
          ))}

        {state?.phase === 'ended' && (
          <div className="hud-winner text-center justify-center items-center">
            <span className="hud-winner-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {state.winner ? (
                <>
                  ★ {state.winner === SHARK_PLAYER_NAME && <SharkIcon size={21} />}
                  <PlayerName name={state.winner} rainbow={isRainbowName(state.winner)} upper /> WINS
                </>
              ) : 'GAME OVER'}
            </span>
          </div>
        )}
    </div>
  );

  // Compact overlay shot log: newest-first, trimmed to a few lines so it
  // doesn't grow unbounded on stream. Only built when `?log=1`.
  const compactLog = obsLog ? (
    <div className="obs-log">
      {shotLog.length === 0
        ? <div style={{ color: '#006600' }}>_ no shots yet...</div>
        : shotLog.map((e, i) => ({ e, i })).reverse().slice(0, 6).map(({ e, i }) => {
          const t = formatTime(e.gameTime);
          let rest = '';
          if (e.type === 'sink') rest = ` » SINK ${ballLabel(e.ball!)}`;
          else if (e.type === 'foul') rest = ' » FOUL';
          else if (e.type === 'safety') rest = ' » SAFETY';
          else if (e.type === 'miss') rest = ' » MISS';
          else if (e.type === 'win') rest = ` » WIN! ${e.ball ? ballLabel(e.ball) : ''}`;
          else if (e.type === 'lose') rest = ' » LOSS';
          const bpmTag = e.bpm !== undefined ? ` · ${e.bpm.toFixed(1)} BPM` : '';
          return (
            <div key={i} className={`log-entry ${e.type}`}>
              {`[${t}] `}<PlayerName name={e.playerName} rainbow={isRainbowName(e.playerName)} />{rest}{bpmTag}
            </div>
          );
        })
      }
    </div>
  ) : null;

  if (obs) {
    // No active game once it has ended → `:(` (never the winner banner/chrome).
    if (ended) return <ObsIdle scale={obsScale} />;
    // The OBS overlay wraps the real CRT HUD in the Win98 title-bar frame so
    // it composites on stream as a native-looking window. The handle shown in
    // the title bar comes from the resolved /watch/:name (or the host's display
    // name when spectating via share code directly).
    return (
      <div
        className="obs-overlay"
        style={{ transform: `scale(${obsScale})`, transformOrigin: 'top left' }}
      >
        <W98Frame
          handle={watchName ?? hostName}
          rainbow={isRainbowName(hostName)}
          accent={themeColor === 'green' ? null : THEME_ACCENT[themeColor]}
        >
          {hudPanel}
        </W98Frame>
        {compactLog}
      </div>
    );
  }

  return (
    <div className="app-window">
      <Navbar onAbout={onAbout} onAccount={onAccount} onSignIn={onSignIn} />

      {hudPanel}

      <div className="app-body">
        <div>
          <div className="menu-section-label" style={{ marginBottom: 6 }}>SHOT LOG</div>
          <div className="shot-log" style={{ maxHeight: 220, overflowY: 'auto' }}>
            {shotLog.length === 0
              ? <div style={{ color: '#006600' }}>_ no shots yet...</div>
              : shotLog.map((e, i) => ({ e, i })).reverse().map(({ e, i }) => {
                const t = formatTime(e.gameTime);
                let rest = '';
                if (e.type === 'sink') rest = ` » SINK ${ballLabel(e.ball!)}`;
                else if (e.type === 'foul') rest = ' » FOUL';
                else if (e.type === 'safety') rest = ' » SAFETY';
                else if (e.type === 'miss') rest = ' » MISS';
                else if (e.type === 'win') rest = ` » WIN! ${e.ball ? ballLabel(e.ball) : ''}`;
                else if (e.type === 'lose') rest = ' » LOSS';
                const bpmTag = e.bpm !== undefined ? ` · ${e.bpm.toFixed(1)} BPM` : '';
                return (
                  <div key={i} className={`log-entry ${e.type}`}>
                    {`[${t}] `}<PlayerName name={e.playerName} rainbow={isRainbowName(e.playerName)} />{rest}{bpmTag}{e.note ? ` — ${e.note}` : ''}
                  </div>
                );
              })
            }
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn btn-big btn-full" onClick={() => { onBack(); setLocation('/'); }}>
            ← Back
          </button>
          {!ended && joinResult.role !== 'spectator' && (
            <button
              className="btn btn-big btn-danger btn-full"
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
