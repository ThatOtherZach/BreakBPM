import { useEffect, useRef, useState } from 'react';
import JoinedGameScreen from './JoinedGameScreen';
import PlayerProfileScreen from './PlayerProfileScreen';
import { ObsIdle, useObsBodyClass } from './ObsOverlay';
import {
  useResolveWatchByName,
  getResolveWatchByNameQueryKey,
} from '@workspace/api-client-react';

interface Props {
  name: string;
  onBack: () => void;
  onAbout: () => void;
  onAccount: () => void;
  onSignIn: () => void;
  /** OBS overlay mode — chrome-free, transparent HUD for a Browser Source. */
  obs?: boolean;
  /** Also render a compact shot log in the overlay. */
  obsLog?: boolean;
  /** CSS transform scale applied to the whole overlay. */
  obsScale?: number;
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

export default function WatchByNameScreen({ name, onBack, onAbout, onAccount, onSignIn, obs = false, obsLog = false, obsScale = 1 }: Props) {
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
        onAbout={onAbout}
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
      onAbout={onAbout}
      onAccount={onAccount}
      onSignIn={onSignIn}
    />
  );
}
