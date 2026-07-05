import { useEffect, useRef, useState } from 'react';
import JoinedGameScreen from './JoinedGameScreen';
import PlayerProfileScreen from './PlayerProfileScreen';
import { ObsIdle, useObsBodyClass, W98Frame } from './ObsOverlay';
import { WIDGET_BALL_COLORS } from '../lib/streamWidget';
import { THEME_FELT } from '../lib/backgroundVariants';
import {
  useResolveWatchByName,
  getResolveWatchByNameQueryKey,
} from '@workspace/api-client-react';

interface Props {
  name: string;
  onBack: () => void;
  onManual: () => void;
  onAccount: () => void;
  onSignIn: () => void;
  onLegal: () => void;
  /** OBS overlay mode — chrome-free, transparent HUD for a Browser Source. */
  obs?: boolean;
  /** Also render a compact shot log in the overlay. */
  obsLog?: boolean;
  /** CSS transform scale applied to the whole overlay. */
  obsScale?: number;
  /**
   * Render a static demo widget (no game resolution needed). Only meaningful
   * when `obs=true`. Useful for previewing the overlay layout without a live
   * game — visit /watch/<yourhandle>?obs=1&demo=1 to see it.
   */
  demo?: boolean;
}

/**
 * Stub CRT HUD rendered in demo mode (?obs=1&demo=1). Uses the exact same
 * CSS classes as the real hudPanel so the layout, typography, and ball chips
 * are pixel-identical to a live game — just with hardcoded fixture data.
 */
const DEMO_SOLIDS  = [1, 2, 3, 4, 5, 6, 7];
const DEMO_STRIPES = [9, 10, 11, 12, 13, 14, 15];
const DEMO_SUNK_S  = new Set([1, 2, 5]);
const DEMO_SUNK_T  = new Set([9, 10, 13]);
const BOARD_ACTIVE = '#d8b4ff';
const BOARD_BORDER = '#5a2a8a';
const BOARD_TEXT   = '#d8b4ff';

function DemoChip({ b, sunk = false }: { b: number; sunk?: boolean }) {
  const cls = `hud-chip ${
    b === 8 ? 'hud-chip-eight' : DEMO_SOLIDS.includes(b) ? 'hud-chip-solid' : 'hud-chip-stripe'
  }${sunk ? ' hud-chip-sunk' : ''}`;
  return (
    <span
      className={cls}
      data-number={b}
      style={{ '--chip-color': WIDGET_BALL_COLORS[b] } as React.CSSProperties}
      aria-label={`Ball ${b}${sunk ? ' (sunk)' : ''}`}
    />
  );
}

function DemoCrtHud() {
  const felt = THEME_FELT.green;
  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', flexDirection: 'column', gap: 2,
    padding: '3px 8px', marginTop: 3,
    background: '#1a0a2e',
    border: `1px solid ${active ? BOARD_ACTIVE : BOARD_BORDER}`,
    fontFamily: "'VT323',monospace", fontSize: 14, color: BOARD_TEXT,
  });
  return (
    <div className="hud-panel">
      <div className="hud-top">
        <div className="hud-bpm-block">
          <div className="hud-bpm-label">BALLS/MIN</div>
          <div className="hud-bpm-value">4.7</div>
          <div className="hud-bpm-sub">ALICE</div>
        </div>
        <div className="hud-divider" />
        <div className="hud-bpm-block">
          <div className="hud-bpm-label">ACCURACY</div>
          <div className="hud-bpm-value">71%</div>
          <div className="hud-bpm-sub">5/7 MADE</div>
        </div>
        <div className="hud-divider" />
        <div className="hud-right">
          <div className="hud-right-row">
            <span className="hud-meta-label">TIME</span>
            <span className="hud-timer">07:23</span>
          </div>
          <div className="hud-right-row">
            <span className="hud-meta-label">MODE</span>
            <span className="hud-mode">8-BALL<span className="hud-mode-players"> · 2P</span></span>
          </div>
        </div>
      </div>
      <div
        className="hud-terminal"
        style={{ '--felt-color': felt.felt, '--felt-shadow': felt.feltShadow } as React.CSSProperties}
      >
        <div className="rack-grouped">
          <div className="rack-side">{DEMO_SOLIDS.map(b => <DemoChip key={b} b={b} sunk={DEMO_SUNK_S.has(b)} />)}</div>
          <div className="rack-eight"><DemoChip b={8} /></div>
          <div className="rack-side">{DEMO_STRIPES.map(b => <DemoChip key={b} b={b} sunk={DEMO_SUNK_T.has(b)} />)}</div>
        </div>
      </div>
      <div style={rowStyle(true)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ minWidth: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} aria-hidden="true">
            <span className="cue-ball-icon" />
          </span>
          <span style={{ fontSize: 16 }}>Alice ★</span>
          <span style={{ fontSize: 12, opacity: 0.7 }}>· Solids</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minHeight: 26 }}>
          {[5, 2, 1].map(b => <DemoChip key={b} b={b} />)}
        </div>
      </div>
      <div style={rowStyle(false)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ minWidth: 12 }} aria-hidden="true" />
          <span style={{ fontSize: 16 }}>Bob</span>
          <span style={{ fontSize: 12, opacity: 0.7 }}>· Stripes</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minHeight: 26 }}>
          {[13, 10, 9].map(b => <DemoChip key={b} b={b} />)}
        </div>
      </div>
    </div>
  );
}

/**
 * Persistent watch-by-name entry point (/watch/{screenName}). Resolves the
 * host's screen name to the share code of their CURRENT live game, then hands
 * off to the read-only JoinedGameScreen. Unlike a per-game share code, this
 * handle is stable across the host's games — bookmark it once and it always
 * lands on whatever game they have open now.
 *
 * While the host has no live game we keep polling so the page promotes itself
 * the moment they start one. Once a live game is found we latch its share code
 * and JoinedGameScreen owns everything from there (polling + the ended state);
 * to follow a later game, reload the page.
 */
// "Waiting room" poll cadences (no live game yet). Fast while a human is
// present; backs off to slow after a stretch of no interaction so an
// unattended overlay/tab lets the DB suspend.
const RESOLVE_FAST_MS = 4000;
const RESOLVE_IDLE_MS = 30000;
const RESOLVE_IDLE_AFTER_MS = 2 * 60 * 1000;

export default function WatchByNameScreen({ name, onBack, onManual, onAccount, onSignIn, onLegal, obs = false, obsLog = false, obsScale = 1, demo = false }: Props) {
  const [liveCode, setLiveCode] = useState<string | null>(null);
  useObsBodyClass(obs);

  // Land at the top when arriving here (e.g. the leaderboard "Who?" jump):
  // client-side route changes keep the previous scroll position, so reset both
  // the document (page-scroll variants) and the .app-body container.
  useEffect(() => {
    if (obs) return;
    window.scrollTo(0, 0);
    document.querySelector(".app-body")?.scrollTo?.(0, 0);
  }, []);

  // Idle-backoff for the "waiting for a live game" poll. While the host has no
  // live game we keep polling so the page promotes itself the instant they
  // break — but an unattended overlay/forgotten tab shouldn't keep the DB
  // awake forever. So we poll fast (4s) while a human is present, and after a
  // stretch of no interaction we back off to a slow 30s cadence. ANY user
  // interaction (or the tab regaining focus) snaps it back to fast. An OBS
  // overlay generates no interaction, so it backs off and lets the DB suspend;
  // a person actively waiting always gets the fast pickup. This affects ONLY
  // the no-live-game waiting state — once a game resolves, JoinedGameScreen
  // owns polling at the full spectator cadence.
  const [resolveInterval, setResolveInterval] = useState<number>(RESOLVE_FAST_MS);
  const lastActiveRef = useRef<number>(Date.now());
  useEffect(() => {
    if (liveCode) return;
    const markActive = () => {
      if (document.visibilityState === 'hidden') return;
      lastActiveRef.current = Date.now();
      setResolveInterval(RESOLVE_FAST_MS);
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll', 'visibilitychange'] as const;
    for (const e of events) document.addEventListener(e, markActive, { passive: true });
    const checkId = window.setInterval(() => {
      if (Date.now() - lastActiveRef.current >= RESOLVE_IDLE_AFTER_MS) {
        setResolveInterval(RESOLVE_IDLE_MS);
      }
    }, 10000);
    return () => {
      for (const e of events) document.removeEventListener(e, markActive);
      window.clearInterval(checkId);
    };
  }, [liveCode]);

  const resolve = useResolveWatchByName(
    { name },
    {
      query: {
        queryKey: getResolveWatchByNameQueryKey({ name }),
        refetchInterval: liveCode ? false : resolveInterval,
        enabled: !liveCode,
      },
    },
  );

  useEffect(() => {
    if (resolve.data?.found && resolve.data.shareCode) {
      setLiveCode(resolve.data.shareCode);
    }
  }, [resolve.data]);

  if (liveCode) {
    return (
      <JoinedGameScreen
        code={liveCode.toUpperCase()}
        onBack={onBack}
        onManual={onManual}
        onAccount={onAccount}
        onSignIn={onSignIn}
        spectatorOnly
        obs={obs}
        obsLog={obsLog}
        obsScale={obsScale}
        watchName={name}
      />
    );
  }

  // Demo mode: render the real CRT HUD with stub data so the overlay layout,
  // typography, and ball chips look exactly like a live game — just no polling.
  // Visit /watch/<yourhandle>?obs=1&demo=1 to preview it.
  if (obs && demo) {
    return (
      <div
        className="obs-overlay"
        style={{ transform: `scale(${obsScale})`, transformOrigin: 'top left' }}
      >
        <W98Frame handle={name}>
          <DemoCrtHud />
        </W98Frame>
      </div>
    );
  }

  // No live game (yet). In OBS overlay mode we never show the profile/error
  // chrome — just the `:(` idle face — while polling continues to promote us
  // to the live HUD the moment the host breaks.
  if (obs) {
    return <ObsIdle scale={obsScale} />;
  }

  // Normal spectator view: show the player's public profile while we keep
  // polling in the background; the effect above promotes us to the live
  // spectator view the moment they break. The profile screen owns its own
  // loading / not-found / rate-limited / error states.
  return (
    <PlayerProfileScreen
      name={name}
      onBack={onBack}
      onManual={onManual}
      onAccount={onAccount}
      onSignIn={onSignIn}
      onLegal={onLegal}
    />
  );
}
