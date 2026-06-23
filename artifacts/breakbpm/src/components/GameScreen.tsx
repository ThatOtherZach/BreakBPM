import { useState, useEffect, useRef, useCallback, Fragment, type CSSProperties } from 'react';
import { useLocation } from 'wouter';
import type { GameState, ShotLogEntry, RematchConfig } from '../lib/gameLogic';
import { THEME_FELT, THEME_ACCENT, themeColorOf } from '../lib/backgroundVariants';
import Navbar from './Navbar';
import {
  getLegalBalls, getRemainingBalls, getAllBalls, checkSinkResult,
  assignTeams, shouldAssignTeams, calculatePlayerBPM,
  calculatePlayerAccuracy, playerAccuracyCounts, formatTime,
  ballLabel,
  SOLIDS, STRIPES, EIGHT_BALL,
  saveInProgressGame, clearInProgressGame,
  isSharkGame, applySharkMiss,
  getSharkPickCandidates, resolveSharkPick,
  SHARK_PLAYER_NAME, chaosMostSunkWinner,
} from '../lib/gameLogic';
import SharkIcon from './SharkIcon';
import { PlayerName } from './PlayerName';
import { QRCodeSVG } from 'qrcode.react';
import { W98Frame } from './ObsOverlay';
import { shareWidgetImage, copyText } from '../lib/streamWidgetImage';
import {
  useSaveGame,
  useRecordGameActivity,
  useGetMe,
  useGetGameStateByCode,
  getGetGameStateByCodeQueryKey,
  useListAds,
  useFindHallCandidates,
  useTagGameHall,
} from '@workspace/api-client-react';
import type { HallCandidate, TaggedHall } from '@workspace/api-client-react';
import { FORFEIT_INACTIVITY_MS, MAX_GAME_DURATION_MS } from '../lib/forfeit';

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
  /**
   * Start a Rematch with the same mode/players/settings. Resolves once a new
   * server game is created and the app swaps to it; rejects on failure so the
   * end screen can re-enable the button for a retry.
   */
  onRematch: (cfg: RematchConfig) => Promise<void>;
  /**
   * Whether the current viewer is signed in. Rematch is only offered to
   * logged-in players; signed-out players get a fresh New Game only.
   */
  isAuthenticated: boolean;
  onAbout: () => void;
  onAccount: () => void;
  onStats: () => void;
  onFindPlayers: () => void;
  onSignIn: () => void;
}


const BALL_COLORS: Record<number, string> = {
  1: '#FDD307', 2: '#1F4E9E', 3: '#C3342B', 4: '#5B247A',
  5: '#F27C1D', 6: '#276B40', 7: '#6B1F2A', 8: '#000000',
  9: '#FDD307', 10: '#1F4E9E', 11: '#C3342B', 12: '#5B247A',
  13: '#F27C1D', 14: '#276B40', 15: '#6B1F2A',
};

const SPINNER_FRAMES = ['|', '/', '-', '\\'];

// How long an accidental game-ending shot can be taken back before the
// final result is saved and locked in.
const END_UNDO_WINDOW_SEC = 5;
const END_UNDO_WINDOW_MS = END_UNDO_WINDOW_SEC * 1000;

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

/** Human distance label for a hall candidate (meters → "120 m" / "1.4 km"). */
function hallDistanceLabel(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** Display label for the server's fixed "Add to Hall" proximity cap
 * (HALL_TAG_RADIUS_METERS = 300 in the api-server). Keep in lockstep. */
const HALL_TAG_RADIUS_LABEL = '300 m';

/** Friendly copy for an "Add to Hall" rejection reason (server-supplied). */
function hallTagFailureMessage(reason: string | undefined): string {
  switch (reason) {
    case 'not_finalized':
      return 'This game is still saving — try again in a moment.';
    case 'already_tagged':
      return 'This game is already linked to a hall.';
    case 'wrong_type':
      return 'Only 8-ball and 9-ball games can be added to a hall.';
    case 'not_host':
      return 'Only the game host can add a game to a hall.';
    case 'not_signed_in':
      return 'Sign in to add a game to a hall.';
    case 'venue_not_found':
      return 'That hall is no longer available.';
    case 'out_of_range':
      return "You're not close enough to that hall anymore.";
    default:
      return 'Could not add this game to a hall. Try again.';
  }
}

export default function GameScreen({ initialState, serverGameId, maxGameDurationMs, initialPausedDuration = 0, onNewGame, onRematch, isAuthenticated, onAbout, onAccount, onStats, onFindPlayers, onSignIn }: Props) {
  const [, navigate] = useLocation();
  const saveGame = useSaveGame();
  const recordActivity = useRecordGameActivity();
  const me = useGetMe();
  const hasActivePass = me.data?.entitlement?.hasActivePass ?? false;
  const spectatingEnabled = me.data?.entitlement?.tier === 'pass';

  // "Add to Hall" — a signed-in HOST can tag a finished 8-ball/9-ball game to
  // the nearest active Verified Hall. The button replaces "Copy Link" on those
  // modes (see the share row). The whole flow is geolocation → server-checked
  // candidate list → confirm/pick → tag, with the server re-validating every
  // condition and re-computing distance authoritatively.
  const findHallCandidates = useFindHallCandidates();
  const tagHall = useTagGameHall();
  const [hallOpen, setHallOpen] = useState(false);
  const [hallPhase, setHallPhase] = useState<'idle' | 'locating' | 'choose' | 'tagging' | 'done' | 'error'>('idle');
  const [hallCandidates, setHallCandidates] = useState<HallCandidate[]>([]);
  const [hallCoords, setHallCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [hallError, setHallError] = useState('');
  const [taggedHall, setTaggedHall] = useState<TaggedHall | null>(null);

  // HUD text ads: shown only to non-paying viewers (anyone whose tier is not
  // `pass`). Anonymous / still-loading callers are treated as non-paid so they
  // see ads. The ad advances to the next one every THIRD shot within a game,
  // and the rotation continues in order across games via a localStorage pointer
  // (a fresh game starts right after the last ad shown).
  const AD_ROTATION_KEY = 'breakbpm.adRotation';
  const isPaidViewer = me.data?.entitlement?.tier === 'pass';
  const adsQuery = useListAds();
  const ads = adsQuery.data?.ads ?? [];
  // Base pointer captured once on mount so the within-game stepping is stable.
  const [adBase, setAdBase] = useState<number | null>(null);
  useEffect(() => {
    if (adBase !== null) return;
    let ptr = 0;
    try {
      const raw = Number(localStorage.getItem(AD_ROTATION_KEY) ?? '0');
      if (Number.isFinite(raw) && raw >= 0) ptr = Math.floor(raw);
    } catch { /* localStorage unavailable — start at 0 */ }
    setAdBase(ptr);
  }, [adBase]);
  // Tint the pool-table HUD felt to the signed-in player's profile theme. The
  // effective theme mirrors the Account picker: "auto" resolves to the stored
  // background, anything else uses the explicit choice; absent/"none" → green.
  const acct = me.data?.account;
  // "rainbow" is a name-only flair and pins no felt artwork, so it tints the
  // felt exactly like "auto" (default green, or the auto-earned color).
  const effectiveTheme =
    acct?.profileTheme === 'auto' || acct?.profileTheme === 'rainbow'
      ? (acct?.profileBackground ?? 'none')
      : (acct?.profileTheme ?? 'none');
  const themeColor = themeColorOf(effectiveTheme);
  const felt = THEME_FELT[themeColor];
  // W98 title-bar accent for the offscreen share-image window chrome — mirrors
  // the OBS overlay (the green theme keeps the classic blue title bar).
  const w98Accent = themeColor === 'green' ? null : THEME_ACCENT[themeColor];
  const savedRef = useRef(false);
  const forfeitedRef = useRef(false);
  const [state, setState] = useState<GameState>(initialState);
  const [elapsed, setElapsed] = useState(0);

  // Step forward one ad for every three shots logged this game (see the ad
  // gating/rotation setup above for the base pointer + cross-game continuity).
  const adStep = Math.floor(state.shotLog.length / 3);
  const currentAd =
    !isPaidViewer && adBase !== null && ads.length > 0
      ? ads[(adBase + adStep) % ads.length]
      : null;
  // Persist the NEXT pointer only when this game ends, so the following game
  // continues the rotation in order (right after the last ad shown). Persisting
  // on end (not on every step) keeps a mid-game refresh on the same ad instead
  // of jumping it forward.
  useEffect(() => {
    if (adBase === null || ads.length === 0 || state.phase !== 'ended') return;
    try {
      localStorage.setItem(AD_ROTATION_KEY, String((adBase + adStep + 1) % 1_000_000));
    } catch { /* ignore persistence failure */ }
  }, [adBase, adStep, ads.length, state.phase]);

  // Resolve which of THIS game's participants render the rainbow name from the
  // single game-state participants payload (the same source the spectator/OBS
  // views use) so the host HUD can rainbow a qualifying name too — without ever
  // shipping the admin email list to the client. The flag is static for a
  // game, so we only poll lazily, and only for server-backed (signed-in)
  // games (anonymous play has no server row and can never qualify).
  const hostStateSnap = useGetGameStateByCode(
    { code: state.shareCode },
    {
      query: {
        queryKey: getGetGameStateByCodeQueryKey({ code: state.shareCode }),
        enabled: !!serverGameId && !!state.shareCode,
        refetchInterval: state.phase === 'playing' ? 8000 : false,
      },
    },
  );
  const rainbowParticipants = hostStateSnap.data?.participants ?? [];
  // Slot-keyed lookup for the player list (gameState.players[i] maps to
  // participant slotIndex i), which avoids mislabeling when two players share
  // a display name. The shot log/win banner only carry a name string, so those
  // fall back to name matching (matched within this one game, as the task
  // sanctions).
  const rainbowBySlot = new Map(rainbowParticipants.map((p) => [p.slotIndex, p.rainbowName]));
  const rainbowNames = new Set(
    rainbowParticipants.filter((p) => p.rainbowName).map((p) => p.displayName),
  );
  const isRainbowName = (name: string | null | undefined): boolean =>
    !!name && rainbowNames.has(name);

  // BPM is per-player and derived from the shot log + lastActionTime
  // (see `dispBpm` below). No standalone bpm state is kept.

  const [toast, setToast] = useState('');
  const [undoStack, setUndoStack] = useState<GameState[]>([]);
  const [clock, setClock] = useState('');
  const [confirmNew, setConfirmNew] = useState(false);
  // End-of-game undo window: when a player-action ending (win/lose/foul-on-8)
  // happens, we briefly hold the save and offer an Undo so an accidental
  // last shot can be taken back. After the window the button swaps to
  // "New Game" and the final state is saved (locked in).
  const [endUndoOpen, setEndUndoOpen] = useState(false);
  const [endUndoLeft, setEndUndoLeft] = useState(0);
  // True while a Rematch is being created (server round-trip). Disables the
  // end-screen buttons so a double-tap can't spawn two games.
  const [rematchPending, setRematchPending] = useState(false);
  const [spinFrame, setSpinFrame] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  // Offscreen-rendered Win98 share widget, snapshotted to a PNG on "Share".
  const shareWidgetRef = useRef<HTMLDivElement>(null);
  const [sharingImage, setSharingImage] = useState(false);

  // Long-press on the share-CODE 📋 button reveals a join QR in place of the
  // Mode/Time/Code panel (mirrors the splash-screen QR easter egg). A short
  // press still copies the code; a >1s hold reveals the QR for 8s and the
  // trailing click is suppressed so it doesn't also copy.
  const [showCodeQr, setShowCodeQr] = useState(false);
  const codeQrPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeQrRevertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeQrLongPressFired = useRef(false);
  const clearCodeQrPress = () => {
    if (codeQrPressTimer.current !== null) {
      clearTimeout(codeQrPressTimer.current);
      codeQrPressTimer.current = null;
    }
  };
  const startCodeQrPress = () => {
    clearCodeQrPress();
    codeQrLongPressFired.current = false;
    codeQrPressTimer.current = setTimeout(() => {
      codeQrPressTimer.current = null;
      codeQrLongPressFired.current = true;
      setShowCodeQr(true);
      if (codeQrRevertTimer.current !== null) clearTimeout(codeQrRevertTimer.current);
      codeQrRevertTimer.current = setTimeout(() => {
        codeQrRevertTimer.current = null;
        setShowCodeQr(false);
      }, 8000);
    }, 1000);
  };
  useEffect(() => () => {
    clearCodeQrPress();
    if (codeQrRevertTimer.current !== null) clearTimeout(codeQrRevertTimer.current);
  }, []);

  // Practice-mode pause. Seed pausedDuration from a restored in-progress
  // game so the elapsed clock continues from where it left off.
  const [paused, setPaused] = useState(false);
  const [pausedDuration, setPausedDuration] = useState(initialPausedDuration);
  const [pauseStart, setPauseStart] = useState<number | null>(null);

  // Host's URL stays on '/' (the setup→game flow). The share code is
  // displayed in the HUD and emitted as a `/join/<code>` link by
  // handleShare(). We deliberately stop writing it into the host's URL
  // so a stray reload doesn't try to route the host through the
  // joiner/spectator view (which is read-only).
  const syncUrl = useCallback((_s: GameState) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('state');
      url.searchParams.delete('game');
      window.history.replaceState(null, '', url.toString());
    } catch { /* noop */ }
  }, []);

  // v0.8: name-merge polling was removed. Joining is now pre-break
  // only, so any joiner-supplied name lives entirely in the joiner's
  // own view (rendered from /games/state). The host's local
  // `state.players[].name` (whatever they typed at setup) stays
  // authoritative on the scorekeeper device — no cross-device merge
  // is needed.

  // Timer — only tracks elapsed time. BPM is NOT updated here.
  // Anchored on timerStartTime (set on the first pocket) so break/racking
  // doesn't inflate the visible clock. Stays at 0 until the first ball drops.
  // Stops when paused; pausedDuration is subtracted so the displayed time excludes idle pauses.
  useEffect(() => {
    if (state.phase !== 'playing' || paused) return;
    if (state.timerStartTime == null) { setElapsed(0); return; }
    const id = setInterval(() => {
      setElapsed(Date.now() - state.timerStartTime! - pausedDuration);
    }, 1000);
    return () => clearInterval(id);
  }, [state.phase, state.timerStartTime, paused, pausedDuration]);

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
  //
  // A player-action ending (win/lose/foul-on-8) is *undoable*: it left a
  // snapshot on the undo stack and did NOT set forfeitedRef. For those we
  // hold the save for END_UNDO_WINDOW_MS and surface an Undo button so an
  // accidental final shot can be taken back; the save fires when the window
  // closes. Authoritative endings (60-min forfeit, wall-clock cap, server
  // sweep — all flagged via forfeitedRef) are not undoable and save
  // immediately, exactly as before.
  useEffect(() => {
    if (state.phase !== 'ended' || savedRef.current) return;

    // Freeze the end timestamp so the deferred save records the true game
    // duration (not duration + the 5s undo window).
    const endedAt = Date.now();

    const doSave = () => {
      if (savedRef.current) return;
      savedRef.current = true;
      setEndUndoOpen(false);
      // Saved BPM is the winning player's per-player BPM. In Shark Mode we
      // always save the human's BPM regardless of who won (Shark has no
      // meaningful pace metric).
      const bpmPlayerName = isSharkGame(state)
        ? state.players[0]?.name ?? ''
        : (state.winner ?? state.players[state.currentPlayerIndex]?.name ?? '');
      const finalBpmSnap = bpmPlayerName
        ? calculatePlayerBPM(state.shotLog, bpmPlayerName)
        : null;
      // Accuracy mirrors BPM exactly: the same player, snapshotted at game end.
      const finalAccSnap = bpmPlayerName
        ? calculatePlayerAccuracy(state.shotLog, bpmPlayerName)
        : null;
      // Per-participant accuracy: each player's own accuracy, keyed by slot
      // index (slot i == state.players[i], matching the server's slot
      // allocation). The host computes every slot from the shots it logged
      // under that player's name so a joiner sees their OWN accuracy in
      // history, not the host/winner's. The invisible Shark is virtual (not
      // in state.players), so it never produces a slot here.
      const participantAccuracies = state.players.map((p, i) => ({
        slotIndex: i,
        accuracy: calculatePlayerAccuracy(state.shotLog, p.name),
      }));
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
            accuracy: finalAccSnap,
            participantAccuracies,
            durationMs: state.timerStartTime != null
              ? Math.max(0, endedAt - state.timerStartTime - pausedDuration)
              : 0,
            sunkBallsCount: state.sunkBalls.length,
            // Practice and None are no-winner modes — a forced end is recorded
            // as a benign 'expired' (not a 'forfeit', which implies a loser).
            outcome: forfeitedRef.current
              ? (state.gameType === 'practice' || state.chaosMode === 'none' ? 'expired' : 'forfeit')
              : (state.winner
                  ? (state.winner === SHARK_PLAYER_NAME ? 'lost' : 'won')
                  : 'completed'),
            gameState: state as unknown as Record<string, unknown>,
            startedAt: new Date(state.gameStartTime).toISOString(),
          },
        },
        {
          // Drop the in-progress checkpoint on successful save OR when
          // the server tells us it already finalized the row itself
          // (alreadyEnded — sweep beat us to it). In both cases there is
          // nothing more to retry; keeping the checkpoint would cause an
          // infinite replay loop against an immutable row.
          onSuccess: () => clearInProgressGame(),
        },
      );
    };

    // Undoable iff a player action ended the game (snapshot on the stack)
    // and it wasn't a forfeit/cap/sweep ending. Shark Mode is excluded — it's
    // a solo, honor-system mode, so its result saves immediately with no
    // end-of-game undo window.
    const undoable = !forfeitedRef.current && undoStack.length > 0 && !isSharkGame(state);
    if (!undoable) {
      doSave();
      return;
    }

    // Hold the save and run the undo countdown. Undoing (handleUndo) flips
    // the phase back to 'playing', which tears down this effect and cancels
    // the timers below before doSave can fire.
    setEndUndoOpen(true);
    setEndUndoLeft(END_UNDO_WINDOW_SEC);
    const tick = setInterval(() => setEndUndoLeft((n) => Math.max(0, n - 1)), 1000);
    const timer = setTimeout(() => { clearInterval(tick); doSave(); }, END_UNDO_WINDOW_MS);
    return () => { clearInterval(tick); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // Forfeit timer — if no action for FORFEIT_INACTIVITY_MS (60min) the game is
  // automatically ended as a forfeit by the current player. Practice mode is
  // exempt (it has manual pause). Pauses suspend the timer.
  useEffect(() => {
    // Shark mode is solo (no opponent waiting on you) — treat it like
    // practice and skip the 60-min inactivity forfeit.
    if (state.phase !== 'playing' || state.gameType === 'practice' || state.chaosMode === 'none' || isSharkGame(state) || paused) return;
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

  // Hard wall-clock cap from gameStartTime. Applies to ALL game modes
  // (including practice and Shark, signed-in or not) so a reopened tab
  // never shows a multi-hour timer. Versus modes end as a forfeit;
  // practice ends with no winner (saved as `expired`).
  // - Anonymous play: server-supplied `maxGameDurationMs` (1h).
  // - Signed-in / no server value: client constant MAX_GAME_DURATION_MS (1h).
  // The cap is true wall-clock: pause does NOT extend it. A player
  // who pauses for 70 minutes will see the game finalize the moment
  // they unpause (or via the alive:false ping if signed in).
  useEffect(() => {
    if (state.phase !== 'playing') return;
    const cap = maxGameDurationMs ?? MAX_GAME_DURATION_MS;
    const ms = state.gameStartTime + cap - Date.now();
    const fire = () => {
      forfeitedRef.current = true;
      // Practice and None have no winner — the cap just ends the session.
      const noWinner = state.gameType === 'practice' || state.chaosMode === 'none';
      const shark = isSharkGame(state);
      const winnerName = noWinner
        ? null
        : shark
          ? SHARK_PLAYER_NAME
          : state.players.length > 1
            ? state.players[(state.currentPlayerIndex + 1) % state.players.length].name
            : null;
      const capMin = Math.round(cap / 60000);
      const msg = noWinner
        ? `Session ended — sessions are capped at ${capMin} minutes.`
        : `Session ended — games are capped at ${capMin} minutes.`;
      setState(s => ({
        ...s,
        phase: 'ended',
        winner: winnerName,
        winMessage: msg,
        lastActionTime: Date.now(),
      }));
    };
    if (ms <= 0) { fire(); return; }
    const id = setTimeout(fire, ms);
    return () => clearTimeout(id);
  }, [state.phase, state.gameStartTime, state.gameType, state.players, state.currentPlayerIndex, maxGameDurationMs]);

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
    recordActivity.mutate(
      {
        data: {
          gameId: serverGameId,
          gameState: state as unknown as Record<string, unknown>,
        },
      },
      {
        onSuccess: (resp) => {
          // Server-side sweep (hard cap or inactivity) already closed
          // this row authoritatively. Transition the UI to ended so the
          // timer stops climbing, but DO NOT let the auto-save effect
          // re-submit — the server's snapshot is the source of truth
          // here and the client's stale state would overwrite it. We
          // mark `savedRef` to short-circuit the save effect, and clear
          // the local in-progress checkpoint so a refresh doesn't try
          // to replay it.
          if (resp && resp.alive === false) {
            const noWinner = state.gameType === 'practice' || state.chaosMode === 'none';
            const shark = isSharkGame(state);
            const winnerName = noWinner
              ? null
              : shark
                ? SHARK_PLAYER_NAME
                : state.players.length > 1
                  ? state.players[(state.currentPlayerIndex + 1) % state.players.length].name
                  : null;
            savedRef.current = true;
            clearInProgressGame();
            setState(s => s.phase === 'ended' ? s : ({
              ...s,
              phase: 'ended',
              winner: winnerName,
              winMessage: noWinner
                ? 'Session ended — sessions are capped at 60 minutes.'
                : 'Session ended — games are capped at 60 minutes.',
              lastActionTime: Date.now(),
            }));
          }
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverGameId, state.lastActionTime, state.phase]);

  // Auto-scroll log to newest entry (rendered at the top)
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0;
  }, [state.shotLog]);

  const cur = state.players[state.currentPlayerIndex];
  const pendingSharkPick = state.phase === 'playing' && !!state.pendingSharkPick;
  const sharkPickCandidates = pendingSharkPick ? getSharkPickCandidates(state) : [];
  // Shark-mode coaching hint shown under the ball grid. It mirrors the solo
  // player through each phase — open break, group assigned, group cleared — and
  // (uniquely) speaks up during the Shark's steal, where nothing is shown
  // otherwise. Aggression tunes the steal warning: Normal steals on foul, Hard
  // on miss or foul. Non-Shark 8-ball keeps its own single hint below.
  const sharkHint: { icon: string; text: string } | null = (() => {
    if (!isSharkGame(state) || state.phase !== 'playing') return null;
    if (pendingSharkPick) {
      return { icon: '🦈', text: "Shark's turn, select a ball and remove it from the table." };
    }
    if (!state.teamAssigned) {
      return { icon: '💡', text: "Sink any ball to claim your group, the rest are the Shark's. Pot the 8 now and you lose." };
    }
    const player = state.players[0];
    const myGroup = player?.team === 'solids' ? SOLIDS : player?.team === 'stripes' ? STRIPES : [];
    const cleared = myGroup.length > 0 && myGroup.every(b => state.sunkBalls.includes(b));
    if (cleared) {
      return { icon: '💡', text: 'Group cleared, sink the 8 to win! A miss or foul could give the Shark the 8.' };
    }
    const steal = state.sharkAggression === 'hard' ? 'Miss or foul' : 'Foul';
    return { icon: '💡', text: `Clear your group, then sink the 8 to win. ${steal} and the Shark steals a ball.` };
  })();
  const legalBalls = state.phase !== 'playing'
    ? []
    : pendingSharkPick
      ? sharkPickCandidates
      : getLegalBalls(state.gameType, state.players, state.currentPlayerIndex, state.sunkBalls, state.practiceRack);
  // Practice can use the 8-ball (1–15) or 9-ball (1–9) rack; every other mode's
  // rack is fixed by game type.
  const allBalls = getAllBalls(state.gameType, state.practiceRack);
  const remaining = getRemainingBalls(state.sunkBalls, state.gameType, state.practiceRack);

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
    // Pocketing event → start the pace clock if it hasn't started yet.
    // The break and any pre-pocket misses/fouls/safeties leave it at null.
    if (next.timerStartTime == null) next.timerStartTime = now;

    // Chaos / None games have no solids/stripes groups — never auto-assign.
    if (!state.chaosMode &&
        shouldAssignTeams(state.gameType, state.teamAssigned, state.sunkBalls, state.shotLog, ball, state.ruleSet)) {
      next.players = assignTeams(state.players, state.currentPlayerIndex, ball);
      next.teamAssigned = true;
    }

    next.sunkBalls = [...next.sunkBalls, ball];

    const result = checkSinkResult(next.gameType, next.players, next.currentPlayerIndex, state.sunkBalls, ball, state.chaosMode);

    const entry: ShotLogEntry = {
      type: result.win ? 'win' : result.lose ? 'lose' : 'sink',
      playerName: cur.name,
      ball,
      timestamp: now,
      gameTime: now - next.timerStartTime,
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
    } else if (state.chaosMode === 'none' && remaining.length === 1) {
      // No-winner free-for-all: emptying the table just ends the session
      // (like Practice), with no winner recorded.
      next.phase = 'ended';
      next.winner = null;
      const finalBpm = calculatePlayerBPM([...next.shotLog, entry], cur.name) ?? 0;
      next.winMessage = `Table cleared! Final BPM: ${finalBpm.toFixed(1)}`;
    } else if (state.chaosMode === 'anything-goes' && remaining.length === 1) {
      // No Rules: the 8 isn't special — clearing the table ends the game and
      // whoever pocketed the most balls wins (a tie records no winner).
      next.phase = 'ended';
      const { winner, tie } = chaosMostSunkWinner([...next.shotLog, entry], next.players);
      next.winner = winner;
      next.winMessage = tie
        ? `Table cleared — it's a TIE! No single winner.`
        : `Table cleared — ${winner} wins with the most balls sunk!`;
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
    // Pre-pocket entries (miss/foul/safety/foul-on-8) don't start the pace
    // clock; their gameTime collapses to 0 if no ball has been sunk yet.
    const gameTime = state.timerStartTime != null ? now - state.timerStartTime : 0;

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
          timestamp: now, gameTime,
          note: 'Foul on the 8-ball',
          // A real foul the player committed — counts toward accuracy even
          // though it's terminal and logged as 'lose'.
          isFoul: true,
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
      timestamp: now, gameTime, note,
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
    // Taking back the game-ending shot closes the end-of-game undo window
    // (the deferred save is cancelled by the effect teardown when the phase
    // flips back to 'playing'). Harmless no-op for in-game undos.
    setEndUndoOpen(false);
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(s => s.slice(0, -1));
    // "No one Saw That" — every revert bumps the running undo tally, which
    // rides along in the gameState JSONB and feeds the Stats page. We carry
    // the *current* count forward (not the snapshot's) so the tally only ever
    // grows, even as we roll the rest of the state back.
    applyState({ ...prev, undoCount: (state.undoCount ?? 0) + 1 });
  }

  function handleShare() {
    // Copy the persistent watch link (or the per-game join link as a
    // fallback) so recipients land in the read-only spectator view.
    navigator.clipboard.writeText(joinUrl)
      .then(() => { setToast('Watch link copied!'); setTimeout(() => setToast(''), 2500); })
      .catch(() => { setToast(joinUrl); setTimeout(() => setToast(''), 3000); });
  }

  // Snapshot the offscreen Win98 widget to a PNG and hand it to the native
  // share sheet (falling back to a download). Used by the end-game "Share".
  async function handleShareImage() {
    const node = shareWidgetRef.current;
    if (!node || sharingImage) return;
    setSharingImage(true);
    try {
      const outcome = await shareWidgetImage({
        node,
        handle: watchName,
        url: joinUrl,
        title: 'BreakBPM',
        text: state.winner ? `${state.winner} just won on BreakBPM!` : 'My BreakBPM game',
      });
      if (outcome === 'downloaded') { setToast('Image saved!'); setTimeout(() => setToast(''), 2500); }
      else if (outcome === 'failed') { setToast('Could not create image'); setTimeout(() => setToast(''), 2500); }
    } finally {
      setSharingImage(false);
    }
  }

  async function handleCopyWatchLink() {
    const ok = await copyText(joinUrl);
    setToast(ok ? 'Watch link copied!' : joinUrl);
    setTimeout(() => setToast(''), ok ? 2500 : 3000);
  }

  // Open the "Add to Hall" panel and ask the browser for the host's location,
  // then fetch the server-vetted list of nearby active Verified Halls. The
  // server re-checks host/finalized/type/already-tagged and computes distance
  // itself; we only forward coordinates. A 200 with `eligible:false` carries a
  // structured reason we map to friendly copy.
  function startAddToHall() {
    if (!serverGameId) return;
    setHallOpen(true);
    setHallError('');
    setTaggedHall(null);
    setHallCandidates([]);
    if (!('geolocation' in navigator)) {
      setHallPhase('error');
      setHallError('Location is unavailable on this device.');
      return;
    }
    setHallPhase('locating');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setHallCoords({ lat, lng });
        try {
          const res = await findHallCandidates.mutateAsync({
            data: { gameId: serverGameId, latitude: lat, longitude: lng },
          });
          if (!res.eligible) {
            setHallPhase('error');
            setHallError(hallTagFailureMessage(res.reason));
            return;
          }
          if (res.candidates.length === 0) {
            setHallPhase('error');
            setHallError(
              res.nearestName && res.nearestDistanceMeters != null
                ? `You're ~${hallDistanceLabel(res.nearestDistanceMeters)} from the nearest Verified Hall (${res.nearestName}). You must be within ${HALL_TAG_RADIUS_LABEL} of it to tag this game.`
                : 'No Verified Hall within range. You can only add a game to a hall you are at.',
            );
            return;
          }
          setHallCandidates(res.candidates);
          setHallPhase('choose');
        } catch {
          setHallPhase('error');
          setHallError('Could not check nearby halls. Try again.');
        }
      },
      () => {
        setHallPhase('error');
        setHallError('Location access is needed to add a game to a hall. Enable it and try again.');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  // Commit the tag to the chosen hall. The server re-validates eligibility and
  // re-computes proximity to THIS venue (rejecting out_of_range), so the value
  // we send for distance is never trusted.
  async function confirmAddToHall(candidate: HallCandidate) {
    if (!serverGameId || !hallCoords) return;
    setHallPhase('tagging');
    try {
      const res = await tagHall.mutateAsync({
        data: { gameId: serverGameId, venueId: candidate.id, latitude: hallCoords.lat, longitude: hallCoords.lng },
      });
      if (!res.success || !res.venue) {
        setHallPhase('error');
        setHallError(hallTagFailureMessage(res.reason));
        return;
      }
      setTaggedHall(res.venue);
      setHallPhase('done');
    } catch {
      setHallPhase('error');
      setHallError('Could not add this game to the hall. Try again.');
    }
  }

  function closeAddToHall() {
    setHallOpen(false);
    setHallPhase('idle');
  }

  async function handleRematch() {
    if (rematchPending) return;
    // The breaker inherits to the winner's slot; if there's no mappable winner
    // (solo/Practice/None modes, or the Shark won) fall back to the previous
    // game's breaker, then slot 0.
    const winnerSlot = state.winner != null
      ? state.players.findIndex(p => p.name === state.winner)
      : -1;
    const breakerIndex = winnerSlot >= 0 ? winnerSlot : (state.breakerIndex ?? 0);
    // Carry teams forward only for MANUAL-team 8-ball (groups pre-assigned at
    // setup). Auto-assign games (ruleSet set) earn their teams during play, so
    // a rematch must start with a clean, unassigned table — strip teams.
    const isManualTeam =
      state.gameType === '8ball' &&
      !isSharkGame(state) &&
      state.chaosMode === undefined &&
      state.ruleSet === undefined &&
      state.players.some(p => p.team !== undefined);
    const players = state.players.map(p =>
      isManualTeam ? { id: p.id, name: p.name, team: p.team } : { id: p.id, name: p.name },
    );
    setRematchPending(true);
    try {
      await onRematch({
        gameType: state.gameType,
        players,
        maxPlayers: state.players.length,
        breakerIndex,
        sharkAggression: state.sharkAggression,
        ruleSet: state.ruleSet,
        chaosMode: state.chaosMode,
        practiceRack: state.practiceRack,
      });
      // On success the app swaps to the new game and remounts this component
      // (keyed on shareCode), so there's no need to clear the pending flag.
    } catch {
      setRematchPending(false);
    }
  }

  function handlePause() {
    if (!paused) {
      // Freeze elapsed precisely at this moment before the interval stops
      setElapsed(state.timerStartTime != null
        ? Date.now() - state.timerStartTime - pausedDuration
        : 0);
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
      timerStartTime: null,
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
  // Accuracy mirrors BPM exactly: same display-player (current shooter, or
  // the winner / human at game end), derived purely from the shot log so it
  // freezes between this player's shots.
  const dispAcc = dispPlayerName
    ? calculatePlayerAccuracy(state.shotLog, dispPlayerName)
    : null;
  const dispAccCounts = dispPlayerName
    ? playerAccuracyCounts(state.shotLog, dispPlayerName)
    : null;
  const dispTime = state.phase === 'playing'
    ? elapsed
    : (state.timerStartTime != null
        ? Math.max(0, Date.now() - state.timerStartTime - pausedDuration)
        : 0);

  // Retro ASCII spinner shown in place of the hero numbers while awaiting the
  // first pocket. Only ticks during live play while a value is still pending —
  // so it doesn't churn re-renders once real numbers show, and doesn't keep
  // spinning on the ended screen if a game finishes before any pocket.
  const awaitingPlay = (dispBpm === null || dispAcc === null) && state.phase !== 'ended';
  const spinner = SPINNER_FRAMES[spinFrame % SPINNER_FRAMES.length];
  useEffect(() => {
    if (!awaitingPlay) return;
    const id = setInterval(() => setSpinFrame(f => (f + 1) % SPINNER_FRAMES.length), 110);
    return () => clearInterval(id);
  }, [awaitingPlay]);

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
      // Labeled generically as "BALLS LEFT" since the count rolls in the
      // 8-ball, which isn't part of the player's solids/stripes group.
      const total = myLeft + eightLeft;
      remainingSubLabel = `${total} BALLS LEFT`;
    }
  } else if (state.chaosMode === 'eight-last') {
    // Chaos "8-Ball" rule: the 8 must be sunk last, so once it's the only
    // ball left the table is one shot from a win.
    const remain = getRemainingBalls(state.sunkBalls, state.gameType);
    remainingSubLabel =
      remain.length === 1 && remain[0] === EIGHT_BALL ? '8-BALL TO WIN' : `${remain.length} BALLS LEFT`;
  } else {
    const left = getRemainingBalls(state.sunkBalls, state.gameType, state.practiceRack).length;
    remainingSubLabel = `${left} BALLS LEFT`;
  }

  // Canonical spectator URL. Signed-in hosts get the PERSISTENT
  // `/watch/<screenName>` link, which always resolves to whatever game
  // they have open now — so the QR/link stays valid across future games
  // without resharing. We fall back to the per-game `/join/<code>` link
  // when no screen name is available (shouldn't happen here, since the
  // QR only renders for pass-holding signed-in hosts).
  const watchName = me.data?.account?.screenName ?? null;
  const baseOrigin = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`;
  const joinUrl = watchName
    ? `${baseOrigin}/watch/${encodeURIComponent(watchName)}`
    : `${baseOrigin}/join/${state.shareCode}`;

  const rackChip = (b: number) => {
    const isSunk = state.sunkBalls.includes(b);
    const sunkByShark = (state.sharkSunkBalls ?? []).includes(b);
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

  // Winner(s): for team games (4P), the whole winning team shares the star and
  // the "X & X WINS" callout. Non-team games (2P/Shark/9-ball/practice) → just
  // the single winner.
  const winnerPlayer = state.winner ? state.players.find(p => p.name === state.winner) : undefined;
  const winningNames: string[] = state.winner
    ? (winnerPlayer?.team
        ? state.players.filter(p => p.team === winnerPlayer.team).map(p => p.name)
        : [state.winner])
    : [];
  const winningNameSet = new Set(winningNames);

  // The dark CRT HUD panel. Rendered live in-app, and — wrapped in the Win98
  // window frame — snapshotted for the end-game "Share Card" image (the same
  // real HUD the OBS overlay shows, so the image cannot drift from the live
  // HUD). `forImage` drops the interactive/non-share bits (the rotating text
  // ads + the copy-code button) and pins the static TIME/MODE/CODE column.
  const renderHudPanel = (forImage: boolean) => (
    <div className="hud-panel">

      {/* Top row: BPM + right column */}
      <div className="hud-top">

        {/* BPM — the hero number */}
        <div className="hud-bpm-block">
          <div className="hud-bpm-label">BPM</div>
          <div className={`hud-bpm-value${dispBpm === null ? ' hud-bpm-dim' : ''}`}>
            {dispBpm !== null ? dispBpm.toFixed(1) : (awaitingPlay ? spinner : '--.-')}
          </div>
          <div className="hud-bpm-sub">
            {dispBpm === null ? 'AWAITING PLAY' : remainingSubLabel}
          </div>
        </div>

        {/* Divider */}
        <div className="hud-divider" />

        {/* Accuracy — twin hero number, equal weight to BPM */}
        <div className="hud-bpm-block">
          <div className="hud-bpm-label">ACCURACY</div>
          <div className={`hud-bpm-value${dispAcc === null ? ' hud-bpm-dim' : ''}`}>
            {dispAcc !== null ? `${dispAcc}%` : (awaitingPlay ? spinner : '--%')}
          </div>
          <div className="hud-bpm-sub text-[#00ff41]">
            {dispAcc === null || dispAccCounts === null
              ? 'AWAITING PLAY'
              : `${dispAccCounts.made}/${dispAccCounts.attempts} MADE`}
          </div>
        </div>

        {/* Divider */}
        <div className="hud-divider" />

        {/* Right: mode + timer + share. Long-pressing the 📋 swaps this
            column for a join QR (see startCodeQrPress) for 8 seconds. */}
        <div className="hud-right">
          {!forImage && showCodeQr ? (
            <div
              style={{ background: '#fff', padding: 6, lineHeight: 0, borderRadius: 2, alignSelf: 'center' }}
              aria-label={`QR code to join game ${state.shareCode}`}
            >
              <QRCodeSVG value={`${baseOrigin}/join/${state.shareCode}`} size={92} level="M" />
            </div>
          ) : (
            <>
              <div className="hud-right-row">
                <span className="hud-meta-label">TIME</span>
                <span className={`hud-timer${paused ? ' hud-timer-paused' : ''}`}>{formatTime(dispTime)}</span>
              </div>
              <div className="hud-right-row">
                <span className="hud-meta-label">MODE</span>
                <span className="hud-mode">
                  {isSharkGame(state) ? 'Shark'
                    : state.gameType === 'practice' ? 'Practice'
                    : state.gameType === '8ball' ? '8-Ball'
                    : '9-Ball'}
                </span>
              </div>
              <div className="hud-right-row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="hud-meta-label">CODE</span>
                <span className="hud-code">{state.shareCode}</span>
                {!forImage && (
                  <button
                    className="hud-copy-code-btn"
                    onClick={() => {
                      // Suppress the click that trails a long press so a QR
                      // reveal never also copies the code.
                      if (codeQrLongPressFired.current) {
                        codeQrLongPressFired.current = false;
                        return;
                      }
                      navigator.clipboard.writeText(state.shareCode);
                    }}
                    onPointerDown={startCodeQrPress}
                    onPointerUp={clearCodeQrPress}
                    onPointerLeave={clearCodeQrPress}
                    onPointerCancel={clearCodeQrPress}
                    onContextMenu={e => e.preventDefault()}
                    title="Copy code (hold for QR)"
                    aria-label="Copy code, or hold to reveal join QR"
                    style={{
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTouchCallout: 'none',
                      touchAction: 'manipulation',
                    } as React.CSSProperties}
                  >
                    <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1, display: 'block' }}>📋</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Rack tray — in 8-ball (and the 8-ball practice rack) the rack
          clusters solids on the left and stripes on the right with the
          8-ball centered between them as the special winning ball; 9-ball
          (and the 9-ball practice rack) shows a single line of 1–9.
          A ball drains to an empty socket once it's pocketed. */}
      <div
        className="hud-terminal"
        style={{ '--felt-color': felt.felt, '--felt-shadow': felt.feltShadow } as CSSProperties}
      >
        {state.gameType === '9ball' || (state.gameType === 'practice' && state.practiceRack === '9ball') ? (
          <div className="rack-line">{allBalls.map(rackChip)}</div>
        ) : (
          <div className="rack-grouped">
            <div className="rack-side">{SOLIDS.map(rackChip)}</div>
            <div className="rack-eight">{rackChip(EIGHT_BALL)}</div>
            <div className="rack-side">{STRIPES.map(rackChip)}</div>
          </div>
        )}
      </div>

      {/* Per-player / Shark scoreboard rows */}
      {state.phase !== 'setup' && (() => {
        const sharkBalls = state.sharkSunkBalls ?? [];
        const rowStyle: React.CSSProperties = {
          display: 'flex', flexDirection: 'column', gap: 2,
          padding: '3px 8px', marginTop: 3,
          background: '#1a0a2e', border: '1px solid #5a2a8a',
          fontFamily: "'VT323',monospace", fontSize: 14, color: '#d8b4ff',
        };
        const idLine: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
        const ballsLine: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', minHeight: 26 };
        const renderBalls = (balls: number[]) => balls.map((b, i) => (
          <span
            key={i}
            className={`hud-chip ${b === 8 ? 'hud-chip-eight' : SOLIDS.includes(b) ? 'hud-chip-solid' : 'hud-chip-stripe'}`}
            data-number={b}
            style={{ '--chip-color': BALL_COLORS[b] } as React.CSSProperties}
            aria-label={`Ball ${b}`}
          />
        ));
        // Text ad slotted into the scoreboard, only for non-paying viewers and
        // only when there's an ad to show (see currentAd). Styled to read as a
        // plain text ad within the retro HUD without dominating it.
        const adPanel = (!forImage && currentAd) ? (
          <div style={{
            ...rowStyle,
            gap: 1,
            border: '1px dashed #6a3a9a',
            background: '#0a0a1e',
          }}>
            <span style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#7a6a9a' }}>
              Ad{currentAd.sponsor ? ` · ${currentAd.sponsor}` : ''}
            </span>
            <span style={{ fontSize: 16, fontWeight: 'bold', color: '#e8c8ff', lineHeight: 1.1 }}>{currentAd.headline}</span>
            <span style={{ fontSize: 13, color: '#b89ad8', lineHeight: 1.15 }}>{currentAd.tagline}</span>
          </div>
        ) : null;
        // Where the ad sits among the non-shark player rows: after the first
        // two players in doubles (4P), otherwise after the first player —
        // which puts it between the two in singles, and below the lone player
        // in practice (1P). Shark mode slots it before the Shark row instead.
        const adAfterIndex = state.players.length >= 4 ? 1 : 0;
        return (
          <>
            {state.players.map((p, i) => {
              const active = state.phase === 'playing' && i === state.currentPlayerIndex && !pendingSharkPick;
              const myGroup = p.team === 'solids' ? SOLIDS : p.team === 'stripes' ? STRIPES : [];
              const cleared = myGroup.length > 0 && myGroup.every(b => state.sunkBalls.includes(b));
              const mySunk = state.shotLog
                .filter(e => (e.type === 'sink' || e.type === 'win' || e.type === 'lose')
                  && e.playerName === p.name && typeof e.ball === 'number')
                .map(e => e.ball as number);
              const teamLabel = p.team ? (p.team === 'solids' ? 'Solids' : 'Stripes') : null;
              return (
                <Fragment key={p.id}>
                <div style={{
                  ...rowStyle,
                  borderColor: active ? '#d8b4ff' : '#5a2a8a',
                }}>
                  <div style={idLine}>
                    <span style={{ minWidth: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} aria-hidden="true">
                      {active ? <span className="cue-ball-icon" /> : null}
                    </span>
                    <span style={{ fontSize: 16, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {state.phase === 'ended' && winningNameSet.has(p.name) && <span style={{ color: 'var(--amber)' }}>★ </span>}
                      <PlayerName name={p.name} rainbow={rainbowBySlot.get(i) ?? isRainbowName(p.name)} />
                    </span>
                    {teamLabel && (
                      <span style={{ fontSize: 12, opacity: 0.7 }}>
                        · {teamLabel}{cleared && ' ✓'}
                      </span>
                    )}
                  </div>
                  <div style={ballsLine}>
                    {renderBalls(mySunk)}
                  </div>
                </div>
                {!isSharkGame(state) && i === adAfterIndex && adPanel}
                </Fragment>
              );
            })}
            {isSharkGame(state) && adPanel}
            {isSharkGame(state) && (
              <div style={{
                ...rowStyle,
                borderColor: pendingSharkPick ? '#d8b4ff' : '#5a2a8a',
              }}>
                <div style={idLine}>
                  <span style={{ minWidth: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} aria-hidden="true">
                    {pendingSharkPick ? <span className="cue-ball-icon" /> : null}
                  </span>
                  <SharkIcon size={14} />
                  <span style={{ fontSize: 16 }}>SHARK</span>
                </div>
                <div style={ballsLine}>
                  {renderBalls(sharkBalls)}
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* Win/Loss flash — inside HUD */}
      {state.phase === 'ended' && (
        <div className="hud-winner">
          <div className="hud-winner-scroll">
            <span className={`hud-winner-text${forImage ? ' hud-winner-text--static' : ''}`}>
              {state.winner ? (
                <>
                  ★ {state.winner === SHARK_PLAYER_NAME && <SharkIcon size={21} />}
                  {winningNames.map((name, idx) => (
                    <Fragment key={name}>
                      {idx > 0 && ' & '}
                      <PlayerName name={name} rainbow={isRainbowName(name)} upper />
                    </Fragment>
                  ))} WINS
                </>
              ) : 'GAME OVER'}
            </span>
          </div>
          <span className="hud-winner-sub text-[#00ff41] border-t-[#00ff41] border-r-[#00ff41] border-b-[#00ff41] border-l-[#00ff41]">{state.winMessage}</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="app-window">
      <Navbar onAbout={onAbout} onAccount={onAccount} onStats={onStats} onFindPlayers={onFindPlayers} onSignIn={onSignIn} />
      {/* Live CRT HUD. The same render is reused (wrapped in the Win98
          frame) for the offscreen "Share Card" snapshot below, so the
          shared image cannot drift from the live HUD. */}
      {renderHudPanel(false)}
      <div className="app-body">

        {/* Win screen action buttons. During the brief undo window the only
            action is a full-width Undo (with a countdown); once it elapses the
            game is saved. Signed-in players then get New Game + Rematch (Rematch
            starts a fresh game with the same mode/players/settings); signed-out
            players get a full-width New Game only. */}
        {state.phase === 'ended' && (
          endUndoOpen ? (
            <button className="btn btn-big w-full" onClick={handleUndo} style={{ marginTop: 0 }}>
              <span aria-hidden="true" style={{ marginRight: 5, fontSize: 14 }}>↩️</span>Undo ({endUndoLeft})
            </button>
          ) : isAuthenticated ? (
            <div className="grid-2" style={{ marginTop: 0 }}>
              <button className="btn btn-primary btn-big" onClick={onNewGame} disabled={rematchPending}>▶ New Game</button>
              <button className="btn btn-big" onClick={handleRematch} disabled={rematchPending}>
                {rematchPending ? 'Starting…' : '🔄 Rematch'}
              </button>
            </div>
          ) : (
            <button className="btn btn-primary btn-big w-full" onClick={onNewGame} style={{ marginTop: 0 }}>▶ New Game</button>
          )
        )}

        {/* ── Share scorecard ──
            On the ended screen, snapshot the Win98 widget to an image for the
            native share sheet (PNG download fallback), plus a copy-link. Only
            shown once the undo window has closed (game locked in). For a
            signed-in HOST of an 8-ball/9-ball game, "Add to Hall" REPLACES the
            copy-link so the game can be tagged to a nearby Verified Hall; other
            modes / signed-out players keep the copy-link unchanged. */}
        {state.phase === 'ended' && !endUndoOpen && (() => {
          const canTagHall =
            isAuthenticated &&
            serverGameId != null &&
            (state.gameType === '8ball' || state.gameType === '9ball');
          return (
            <div className="grid-2" style={{ marginTop: 8 }}>
              <button className="btn btn-big" onClick={handleShareImage} disabled={sharingImage}>
                {sharingImage ? 'Rendering…' : '📸 Share Game'}
              </button>
              {canTagHall ? (
                hallPhase === 'done' ? (
                  <button className="btn btn-big" disabled>
                    ✅ Added
                  </button>
                ) : (
                  <button
                    className="btn btn-big"
                    onClick={startAddToHall}
                    disabled={hallPhase === 'locating' || hallPhase === 'tagging'}
                  >
                    {hallPhase === 'locating' ? 'Locating…' : '🏆 Tag Leaderboard'}
                  </button>
                )
              ) : (
                <button className="btn btn-big" onClick={handleCopyWatchLink}>
                  🔗 Copy Link
                </button>
              )}
            </div>
          );
        })()}

        {/* ── Add to Hall panel ── server-vetted nearby halls, confirm/pick,
            then the result with a jump to that hall's House Leaderboard. */}
        {state.phase === 'ended' && !endUndoOpen && hallOpen && (
          <div className="panel" style={{ marginTop: 8 }}>
            <div className="panel-header">
              <span>
                <span className="stats-sec-emoji" aria-hidden="true">🏆</span>
                Tag a Verified Hall's Leaderboard
              </span>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {hallPhase === 'locating' && (
                <p style={{ fontFamily: 'VT323', fontSize: 18, margin: 0 }}>📍 Finding the nearest hall…</p>
              )}

              {hallPhase === 'choose' && hallCandidates.length === 1 && (
                <>
                  <p style={{ fontSize: 13, margin: 0, lineHeight: 1.4 }}>
                    Add this game to <strong>{hallCandidates[0].name}</strong>
                    {hallCandidates[0].locality ? ` · ${hallCandidates[0].locality}` : ''}{' '}
                    (~{hallDistanceLabel(hallCandidates[0].distanceMeters)} away)?
                  </p>
                  <div className="grid-2">
                    <button className="btn" onClick={closeAddToHall} disabled={tagHall.isPending}>
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => confirmAddToHall(hallCandidates[0])}
                      disabled={tagHall.isPending}
                    >
                      Confirm
                    </button>
                  </div>
                </>
              )}

              {hallPhase === 'choose' && hallCandidates.length > 1 && (
                <>
                  <p style={{ fontSize: 13, margin: 0, lineHeight: 1.4 }}>Which hall are you at?</p>
                  {hallCandidates.map((c) => (
                    <div
                      key={c.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}
                    >
                      <span style={{ fontSize: 13, minWidth: 0, lineHeight: 1.3 }}>
                        {c.name}
                        {c.locality ? ` · ${c.locality}` : ''}{' '}
                        <span style={{ color: '#666' }}>(~{hallDistanceLabel(c.distanceMeters)})</span>
                      </span>
                      <button
                        className="btn btn-primary"
                        style={{ flexShrink: 0 }}
                        onClick={() => confirmAddToHall(c)}
                        disabled={tagHall.isPending}
                      >
                        Confirm
                      </button>
                    </div>
                  ))}
                  <button className="btn" onClick={closeAddToHall} disabled={tagHall.isPending}>
                    Cancel
                  </button>
                </>
              )}

              {hallPhase === 'tagging' && (
                <p style={{ fontFamily: 'VT323', fontSize: 18, margin: 0 }}>🎱 Adding to hall…</p>
              )}

              {hallPhase === 'done' && taggedHall && (
                <>
                  <p style={{ fontSize: 13, margin: 0, lineHeight: 1.4 }}>
                    ✅ Added to <strong>{taggedHall.name}</strong>!
                  </p>
                  <button
                    className="btn btn-primary w-full"
                    onClick={() => navigate(`/leaderboard/hall/${taggedHall.id}`)}
                  >
                    🏆 House Leaderboard
                  </button>
                  <button className="btn w-full" onClick={closeAddToHall}>
                    Close
                  </button>
                </>
              )}

              {hallPhase === 'error' && (
                <>
                  <p style={{ fontSize: 12, color: '#c00', margin: 0, lineHeight: 1.4 }}>⚠ {hallError}</p>
                  <div className="grid-2">
                    <button className="btn" onClick={closeAddToHall}>
                      Close
                    </button>
                    <button className="btn btn-primary" onClick={startAddToHall}>
                      Try again
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Ball selector ── */}
        {state.phase !== 'ended' && (
          <div>
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
            {isSharkGame(state) ? (
              sharkHint && (
                <div className="notice" style={{ marginTop: 6 }}>
                  <span>{sharkHint.icon}</span>
                  <span style={{ fontSize: 11 }}>{sharkHint.text}</span>
                </div>
              )
            ) : (
              state.gameType === '8ball' && !state.chaosMode && !state.teamAssigned && !pendingSharkPick && (
                <div className="notice" style={{ marginTop: 6 }}>
                  <span>💡</span>
                  <span style={{ fontSize: 11 }}>First ball sunk assigns Solids (1-7) or Stripes (9-15)</span>
                </div>
              )
            )}
          </div>
        )}

        {/* ── Actions ── */}
        {state.phase === 'playing' && (
          <div className="action-grid">
            <button className="btn btn-big" onClick={() => turnAction('miss')} disabled={pendingSharkPick}><span aria-hidden="true" style={{ marginRight: 5, fontSize: 14 }}>❌</span>Miss • 失</button>
            <button className="btn btn-big btn-danger" onClick={() => turnAction('foul', 'Ball to opponent')} disabled={pendingSharkPick}><span className="cue-ball-icon" aria-hidden="true" style={{ marginRight: 5 }} />Foul • 犯</button>
            {state.gameType === 'practice'
              ? <button className={`btn btn-big${paused ? ' btn-primary' : ''}`} onClick={handlePause}>{paused ? '▶️ Resume • 继' : '⏸️ Pause • 暂'}</button>
              : <button className="btn btn-big" onClick={() => turnAction('safety', 'Safety — turn passes')} disabled={pendingSharkPick}><span aria-hidden="true" style={{ marginRight: 5, fontSize: 14 }}>🛡️</span>Safety • 安</button>
            }
            <button className="btn btn-big" onClick={handleUndo} disabled={!undoStack.length}><span aria-hidden="true" style={{ marginRight: 5, fontSize: 14 }}>↩️</span>Undo • 撤</button>
          </div>
        )}

        {/* ── Shot log ── */}
        <div>
          <button
            className="btn w-full"
            style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', minHeight: 32, fontSize: 12 }}
            onClick={() => setLogOpen(o => !o)}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span aria-hidden="true" style={{ fontSize: 14 }}>📜</span>History • 記 ({state.shotLog.length})</span>
            <span>{logOpen ? '▲' : '▼'}</span>
          </button>
          {logOpen && (
            <div className="shot-log" ref={logRef}>
              {state.shotLog.length === 0
                ? <div style={{ color: '#006600' }}>_ no shots yet...</div>
                : state.shotLog.map((e, i) => ({ e, i })).reverse().map(({ e, i }) => {
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
          )}
        </div>

        {state.phase === 'playing' && (
          <div style={{ display: 'flex', gap: 8 }}>
            {state.gameType === 'practice' && (
              <button className="btn btn-big" style={{ flex: 1 }} onClick={handleReset}>
                <span aria-hidden="true" style={{ marginRight: 5, fontSize: 14 }}>🔄</span>Reset • 重置
              </button>
            )}
            <button className="btn btn-big btn-danger" style={{ flex: 1 }} onClick={() => setConfirmNew(true)}>
              <span aria-hidden="true" style={{ marginRight: 5, fontSize: 14 }}>🏁</span>End • 終
            </button>
          </div>
        )}

        {/* ── Spectator QR — paid hosts only ──
            Watching is a paid host feature, so the QR (and the link it
            encodes) only appears while the signed-in host holds an active
            pass/subscription. Scanning opens the read-only spectator view —
            the persistent /watch/<name> link when the host has a screen name,
            or the per-game /join/<code> link as a fallback. Hidden once the
            game ends. */}
        {spectatingEnabled && state.phase === 'playing' && (
          <div
            style={{
              marginTop: 4, padding: '12px 12px 10px',
              background: '#1a0a2e', border: '1px solid #5a2a8a',
              display: 'flex', alignItems: 'center', gap: 14,
              fontFamily: "'VT323',monospace", color: '#d8b4ff',
            }}
          >
            <div style={{ background: '#fff', padding: 6, lineHeight: 0, flexShrink: 0 }}>
              <QRCodeSVG value={joinUrl} size={96} level="M" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, color: '#00ff41', letterSpacing: 1 }}>📡 Watch Live • 观战</div>
              <div style={{ fontSize: 14, opacity: 0.85, marginTop: 2 }}>
                Spectators can follow this game in real time.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <span style={{ fontSize: 13, opacity: 0.7, flexShrink: 0 }}>{watchName ? 'LINK' : 'CODE'}</span>
                <span
                  className="hud-code"
                  style={{ fontSize: watchName ? 13 : 18, wordBreak: 'break-all', minWidth: 0 }}
                >
                  {watchName ? joinUrl.replace(/^https?:\/\//, '') : state.shareCode}
                </span>
              </div>
              <button
                className="btn"
                style={{ minHeight: 28, fontSize: 12, padding: '2px 10px', marginTop: 8 }}
                onClick={handleShare}
              >
                📋 Copy link
              </button>
            </div>
          </div>
        )}

      </div>
      {/* Status bar */}
      <div className="statusbar">
        <div className="statusbar-item" style={{ flex: 2 }}>
          {paused ? '⏸ PAUSED'
            : state.phase === 'playing' ? (pendingSharkPick ? `▶ Shark's turn` : `▶ ${cur.name}'s turn`)
            : state.phase === 'ended' ? '■ Game Over' : '—'}
        </div>
        <div className="statusbar-item" style={{ flex: 1 }}>
          BPM: {dispBpm !== null ? dispBpm.toFixed(1) : '--'}
        </div>
        <div className="statusbar-item" style={{ flex: 1 }}>
          ACC: {dispAcc !== null ? `${dispAcc}%` : '--'}
        </div>
        <div className="statusbar-item">{clock}</div>
      </div>
      {/* Confirm dialog */}
      {confirmNew && (
        <div className="dialog-overlay" onClick={() => setConfirmNew(false)}>
          <div className="dialog-box" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
              <span aria-hidden="true" style={{ fontSize: 26, lineHeight: 1, flexShrink: 0 }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 'bold', marginBottom: 4 }} className="text-[18px]">End current game?</div>
                {!hasActivePass && (
                  <div style={{ fontSize: 12, color: '#444' }}>All progress will be lost.</div>
                )}
              </div>
            </div>
            <div className="grid-2">
              <button className="btn btn-primary btn-big" onClick={onNewGame}>✅ Yes</button>
              <button className="btn btn-big" onClick={() => setConfirmNew(false)}>❌ Cancel • 消</button>
            </div>
          </div>
        </div>
      )}
      {/* Offscreen real HUD wrapped in the Win98 window frame — rendered only
          on the ended screen so the "Share Card" button can snapshot it to a
          PNG (the same real HUD the OBS overlay shows, so the image never
          drifts). Positioned far off-screen (NOT display:none) so html-to-image
          can measure + paint it. */}
      {state.phase === 'ended' && (
        <div
          aria-hidden="true"
          style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none', opacity: 0 }}
        >
          <div ref={shareWidgetRef}>
            <W98Frame handle={watchName} rainbow={rainbowBySlot.get(0) ?? isRainbowName(state.players[0]?.name)} accent={w98Accent}>
              {renderHudPanel(true)}
              {joinUrl && (
                <div className="w98-footer">
                  <div className="w98-footer-qr">
                    <QRCodeSVG value={joinUrl} size={84} />
                  </div>
                  <div className="w98-footer-text">
                    <div className="w98-footer-title">WATCH LIVE</div>
                    <div className="w98-footer-url">
                      {watchName ? `breakbpm.com/watch/${watchName}` : joinUrl}
                    </div>
                    <div className="w98-footer-hint">Scan to follow the table</div>
                  </div>
                </div>
              )}
            </W98Frame>
          </div>
        </div>
      )}
    </div>
  );
}
