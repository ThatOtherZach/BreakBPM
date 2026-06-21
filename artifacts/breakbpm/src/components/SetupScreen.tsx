import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import type { GameType, GameState, Player, SharkAggression, RuleSet, ChaosMode, PracticeRack } from '../lib/gameLogic';
import { normalizeShareCode } from '../lib/gameLogic';
import ballImg from '/eightball_nobg.png';
import Navbar from './Navbar';
import { LeaderboardWidget } from './LeaderboardScreen';
import {
  useStartGame,
  useGetResumableGame,
  useAbandonGame,
  useGetAppConfig,
  useGetMe,
  resolveMention,
} from '@workspace/api-client-react';
import { saveInProgressGame, clearInProgressGame, normalizeSharkIdentity } from '../lib/gameLogic';
import { sanitizePlayerName, MAX_PLAYER_NAME_LENGTH } from '../lib/wordFilter';
import SharkIcon from './SharkIcon';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../lib/authClient';
import { APP_VERSION } from '../lib/version';
import { pickTagline } from '../lib/taglines';
import { usePageMeta, PAGE_META } from '../lib/pageMeta';

const tagline = pickTagline();

const GAME_TYPES: { id: GameType; label: string; desc: string }[] = [
  { id: '8ball', label: '8-Ball', desc: 'Solids vs Stripes' },
  { id: '9ball', label: '9-Ball', desc: 'Sink the 9 to win' },
  { id: 'practice', label: 'Practice', desc: 'Solo drills' },
];

const DEFAULT_NAMES = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
// Names shown in the locked, signed-out setup — exact defaults so anonymous
// games are stored under "Player N" rather than any embellished label.
const SIGNED_OUT_NAMES = DEFAULT_NAMES;
const PLAYER_BALL_COLORS = ['#FDD307', '#1F4E9E', '#C3342B', '#5B247A'];

// Sublabel under "Automatic Team Assignment" — describes when groups lock,
// tracking the selected rule set so the copy never drifts from the behavior.
const RULE_SET_SUBLABEL: Record<RuleSet, string> = {
  'first-ball': 'First ball locks player groups',
  'second-ball': 'Second ball locks player groups',
  'open-through-break': 'Open through break, next ball locks groups',
};

// Rule-set radio options. Each carries the CSS ball-chip art that signals the
// option: the 1 ball (yellow solid) for first-ball; the 6 (green solid) + 9
// (yellow stripe) pair for second-ball (two balls = "second"); and the 8 ball
// for open-through-break. Colors mirror BALL_COLORS in GameScreen.tsx (the
// eight-ball chip needs no color).
const RULE_SET_OPTIONS: {
  value: RuleSet;
  label: string;
  chips: { number: string; chipClass: string; chipColor?: string }[];
}[] = [
  {
    value: 'open-through-break',
    label: 'Open Break',
    chips: [{ number: '8', chipClass: 'hud-chip-eight' }],
  },
  {
    value: 'first-ball',
    label: 'First Ball',
    chips: [{ number: '1', chipClass: 'hud-chip-solid', chipColor: '#FDD307' }],
  },
  {
    value: 'second-ball',
    label: 'Second Ball',
    chips: [
      { number: '6', chipClass: 'hud-chip-solid', chipColor: '#276B40' },
      { number: '9', chipClass: 'hud-chip-stripe', chipColor: '#FDD307' },
    ],
  },
];

// The four states of the Team Mode toggle, cycled in order on each tap:
//   auto   → automatic team assignment (Rule Set radios apply)
//   manual → assign Solids/Stripes yourself (per-player dropdowns)
//   chaos  → no teams, anyone sinks anything, winner recorded (Win Rule radios)
//   none   → no teams, no winner, free shoot-around with BPM tracking
type TeamMode = 'auto' | 'manual' | 'chaos' | 'none';
const TEAM_MODE_CYCLE: TeamMode[] = ['auto', 'manual', 'none', 'chaos'];
const TEAM_MODE_LABEL: Record<TeamMode, string> = {
  auto: '🤝 Normal',
  manual: '🕹️ Manual',
  chaos: '😈 Chaos',
  none: '🤷 None',
};
const TEAM_MODE_SUBLABEL: Record<Exclude<TeamMode, 'auto'>, string> = {
  manual: 'Pick each player’s group yourself',
  chaos: 'No teams, anyone sinks anything, winner recorded',
  none: 'No teams, no winner. Track shots and BPM',
};

// Chaos "Win Rule" radio options (only shown when Team Mode = Chaos). The
// 8-Ball option reuses the 8-ball chip art; "No Rules" shows the rainbow cue
// glyph to signal "anything goes".
const CHAOS_RULE_OPTIONS: {
  value: Extract<ChaosMode, 'eight-last' | 'anything-goes'>;
  label: string;
  cueBall?: boolean;
  chips: { number: string; chipClass: string; chipColor?: string }[];
}[] = [
  {
    value: 'eight-last',
    label: 'Straight Pool',
    chips: [{ number: '8', chipClass: 'hud-chip-eight' }],
  },
  {
    value: 'anything-goes',
    label: 'No Rules',
    cueBall: true,
    chips: [],
  },
];

interface Props {
  onStart: (gt: GameType, players: Player[], serverGameId: string | null, maxGameDurationMs: number | null, serverShareCode: string | null, sharkAggression?: SharkAggression, ruleSet?: RuleSet, chaosMode?: ChaosMode, breakerIndex?: number, practiceRack?: PracticeRack) => void;
  /** Resume an existing game from the server-side in-progress snapshot. */
  onResume: (state: GameState, serverGameId: string | null, maxGameDurationMs: number | null, pausedDuration: number) => void;
  onAbout: () => void;
  onLegal: () => void;
  onAccount: () => void;
  onStats: () => void;
  onFindPlayers: () => void;
  onSignIn: () => void;
}

export default function SetupScreen({ onStart, onResume, onAbout, onLegal, onAccount, onStats, onFindPlayers, onSignIn }: Props) {
  usePageMeta(PAGE_META.home);
  const [, setLocation] = useLocation();
  const startGame = useStartGame();
  const abandonGame = useAbandonGame();
  const me = useGetMe();
  // Paid, signed-in hosts can @mention registered players into a non-host slot
  // to link them (no join code). Used to surface the inline hint; the server
  // re-validates eligibility, so this is presentation only.
  const canMention = me.data?.entitlement?.tier === 'pass';
  const { user, isAuthenticated } = useAuth();
  // Signed-in users always play as themselves in slot 1 — their screen
  // name is prefilled and the input is locked so they can't masquerade
  // as someone else (which would also pollute their own BPM history).
  const lockedPlayer1Name = user?.screenName ?? null;
  // Signed-out (anonymous) users can't set custom names at all — every slot
  // is locked to its "Player N" default. Free-text names from anonymous
  // players don't tie to an account and just add noise, so we nudge them to
  // sign in instead. Mirrors the signed-in slot-1 lock styling.
  const isSignedOut = !isAuthenticated;
  // SetupScreen only mounts when localStorage has no in-progress game
  // (App.tsx routes straight to GameScreen otherwise), so this fetch is
  // already the "fallback path" — different device / cleared browser.
  const resumable = useGetResumableGame();
  const [resumeDismissed, setResumeDismissed] = useState(false);

  const [startError, setStartError] = useState('');
  const [gameType, setGameType] = useState<GameType>('8ball');
  const [playerCount, setPlayerCount] = useState(2);
  const [names, setNames] = useState(['', '', '', '']);
  // Team Mode is a single 4-state cycling toggle (8-ball 2P/4P only):
  //   auto → manual → chaos → none. Defaults to 'auto'.
  const [teamMode, setTeamMode] = useState<TeamMode>('auto');
  // Chaos win rule (only used when teamMode === 'chaos'). 'eight-last' = 8 must
  // be sunk last; 'anything-goes' = first to sink the 8 wins. Default 'eight-last'.
  const [chaosRule, setChaosRule] = useState<Extract<ChaosMode, 'eight-last' | 'anything-goes'>>('eight-last');
  const [manualTeams, setManualTeams] = useState<('solids' | 'stripes' | '')[]>(['', '', '', '']);
  const [joinCode, setJoinCode] = useState('');
  // Join Shared Game panel starts collapsed to keep the main menu short
  // on mobile. Users who don't intend to join shouldn't have to scroll
  // past the input. Not persisted — resets to collapsed on every visit.
  const [joinOpen, setJoinOpen] = useState(false);
  // Shark mode (8-ball + 1P) aggression toggle. Default to 'normal' so new
  // players aren't overwhelmed. Only sent to onStart when the combo matches.
  const [sharkAggression, setSharkAggression] = useState<SharkAggression>('normal');
  // 8-ball group-assignment timing (2P/4P automatic assignment only).
  // Default to 'open-through-break' (the most commonly played rule). Only sent
  // to onStart for automatic-assignment 8-ball; ignored for manual/Shark/Practice.
  const [ruleSet, setRuleSet] = useState<RuleSet>('open-through-break');
  // Practice rack size. Practice stays a no-win BPM drill either way; this only
  // picks which balls are racked: '8ball' = full 1–15 (default/legacy) or
  // '9ball' = 1–9. Only sent to onStart when the mode is Practice.
  const [practiceRack, setPracticeRack] = useState<PracticeRack>('8ball');
  // Which player breaks (takes the first shot). Defaults to slot 0 (Player 1).
  // Only meaningful for multiplayer (2P/4P) — Practice/Shark are solo. Clamped
  // to the active player count (effect below) so a stale index can't survive a
  // switch from Doubles → Singles/Practice/Shark and hand the break to a now-
  // absent slot.
  const [breakerIndex, setBreakerIndex] = useState(0);

  // Live @mention resolution per non-host slot. When a paid host types
  // "@handle" into a Player 2/3/4 field, we debounce-resolve it to a real
  // registered user; on game start the resolved slots are sent as `mentions`
  // so the server mints a pending invite (the recipient opts in from their
  // account). State is per-slot index → resolution status.
  type MentionState =
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'found'; screenName: string }
    | { kind: 'notfound' }
    | { kind: 'atcap' }
    | { kind: 'pass_required' };
  const [mentions, setMentions] = useState<Record<number, MentionState>>({});
  // Per-slot request token so a slow resolve can't overwrite a newer one.
  const mentionReqId = useRef<Record<number, number>>({});

  // Hidden easter egg: press-and-hold the splash 8-ball for 3s to swap the
  // art for a QR code (server-configured promo target), shown inline for 8s
  // before it reverts to the 8-ball. The hold timer fires only if the press is
  // held in place; release / move-away / cancel aborts it, so a tap does nothing.
  const [showQr, setShowQr] = useState(false);
  // The QR target is server-configured (BREAKBPM_PROMO_QR_URL) so promo links
  // can be swapped at runtime without rebuilding the static frontend. Falls
  // back to the marketing site until the config resolves / if it fails.
  const appConfig = useGetAppConfig();
  const qrUrl = appConfig.data?.qrUrl ?? 'https://breakbpm.com';
  // Owner-curated blocklist (server env, delivered via /config). Used to
  // emoji-swap blocked words typed into player-name fields — cleaned at this
  // single source so the swapped name flows consistently into the shot log.
  const bannedWords = appConfig.data?.bannedWords ?? [];
  const qrPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrRevertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearQrPress = () => {
    if (qrPressTimer.current !== null) {
      clearTimeout(qrPressTimer.current);
      qrPressTimer.current = null;
    }
  };
  const startQrPress = () => {
    clearQrPress();
    qrPressTimer.current = setTimeout(() => {
      qrPressTimer.current = null;
      setShowQr(true);
      if (qrRevertTimer.current !== null) clearTimeout(qrRevertTimer.current);
      qrRevertTimer.current = setTimeout(() => {
        qrRevertTimer.current = null;
        setShowQr(false);
      }, 8000);
    }, 3000);
  };
  useEffect(() => () => {
    clearQrPress();
    if (qrRevertTimer.current !== null) clearTimeout(qrRevertTimer.current);
  }, []);

  // Keep slot 1 in sync with the signed-in user's screen name. Runs when
  // auth resolves (login mid-session, page reload, etc.) so the field
  // doesn't lag behind the locked state.
  useEffect(() => {
    if (lockedPlayer1Name === null) return;
    setNames(prev => {
      if (prev[0] === lockedPlayer1Name) return prev;
      const next = [...prev];
      next[0] = lockedPlayer1Name;
      return next;
    });
  }, [lockedPlayer1Name]);

  function handleResume() {
    const offered = resumable.data?.game;
    if (!offered) return;
    const gs = normalizeSharkIdentity((offered.gameState ?? {}) as Partial<GameState>);
    // Best-effort rehydration: if players are missing (older row, server
    // snapshot never received, etc.) fall back to placeholders so the
    // game is still playable rather than silently destroyed. We log what
    // was missing so we can diagnose future issues.
    const missing: string[] = [];
    const resolvedGameType = gs.gameType ?? offered.gameType;
    // Validate each player object — a malformed snapshot (missing id/name)
    // would crash GameScreen on first render. Discard the whole array if
    // any entry is bad and fall back to placeholders.
    const rawPlayers = Array.isArray(gs.players) ? gs.players : [];
    const validPlayers = rawPlayers.filter((p): p is Player =>
      !!p && typeof p === 'object' && typeof (p as Player).id === 'number' && typeof (p as Player).name === 'string',
    );
    let players: Player[] = validPlayers.length === rawPlayers.length ? validPlayers : [];
    if (players.length === 0) {
      missing.push('players');
      // Placeholders sized by game type — practice is solo, 8/9-ball
      // need at least two. The user can rename or start fresh.
      players = resolvedGameType === 'practice'
        ? [{ id: 0, name: 'Player 1' }]
        : [
            { id: 0, name: 'Player 1' },
            { id: 1, name: 'Player 2' },
          ];
    }
    // Clamp currentPlayerIndex into the valid range so a stale/corrupted
    // index can't index past the (possibly-fallback) players array.
    const rawIndex = gs.currentPlayerIndex ?? 0;
    const safeCurrentPlayerIndex = Number.isFinite(rawIndex)
      ? Math.max(0, Math.min(players.length - 1, Math.floor(rawIndex)))
      : 0;
    if (!gs.shareCode) missing.push('shareCode');
    // Validate gameStartTime fallback — NaN here would break the elapsed-
    // time clock. Use now() as a last-resort floor.
    const parsedStarted = new Date(offered.startedAt).getTime();
    const fallbackStart = Number.isFinite(parsedStarted) ? parsedStarted : Date.now();
    const safeGameStartTime = typeof gs.gameStartTime === 'number' && Number.isFinite(gs.gameStartTime)
      ? gs.gameStartTime
      : (missing.push('gameStartTime'), fallbackStart);
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('[resume] snapshot missing fields, using fallbacks:', missing);
    }
    const rehydrated: GameState = {
      phase: 'playing',
      gameType: resolvedGameType,
      players,
      currentPlayerIndex: safeCurrentPlayerIndex,
      sunkBalls: gs.sunkBalls ?? [],
      shotLog: gs.shotLog ?? [],
      gameStartTime: safeGameStartTime,
      firstActionTime: gs.firstActionTime ?? null,
      timerStartTime: gs.timerStartTime ?? null,
      lastActionTime: gs.lastActionTime ?? null,
      winner: gs.winner ?? null,
      winMessage: gs.winMessage ?? '',
      shareCode: gs.shareCode ?? '',
      teamAssigned: gs.teamAssigned ?? false,
      // Preserve shark identity across resume — otherwise a restored Shark
      // game silently degrades into a non-shark solo 8-ball (no steals).
      sharkAggression: gs.sharkAggression,
      sharkSunkBalls: gs.sharkSunkBalls,
      ruleSet: gs.ruleSet,
      // Preserve Chaos/None mode across resume — otherwise a restored Chaos or
      // None game silently degrades into a standard team 8-ball.
      chaosMode: gs.chaosMode,
      // Preserve the Practice rack across resume — otherwise a restored 9-ball
      // practice silently degrades into the full 15-ball rack.
      practiceRack: gs.practiceRack,
      undoCount: gs.undoCount ?? 0,
    };
    // Seed localStorage so the next refresh resumes from local too.
    saveInProgressGame({
      state: rehydrated,
      serverGameId: offered.gameId,
      maxGameDurationMs: null,
      pausedDuration: 0,
      savedAt: Date.now(),
    });
    // Hand off via onResume (NOT onStart) so App.tsx preserves the full
    // rehydrated state instead of overwriting it with a fresh game.
    onResume(rehydrated, offered.gameId, null, 0);
  }

  const [discardError, setDiscardError] = useState('');
  async function handleDiscardResume() {
    const offered = resumable.data?.game;
    if (!offered) {
      setResumeDismissed(true);
      return;
    }
    setDiscardError('');
    try {
      await abandonGame.mutateAsync({ data: { gameId: offered.gameId } });
      clearInProgressGame();
      setResumeDismissed(true);
    } catch (err) {
      // Surface the failure so the user can retry — don't silently
      // dismiss, otherwise the orphan row lingers until the inactivity
      // sweep and the prompt comes back next visit.
      const msg = err instanceof Error ? err.message : 'Network error';
      setDiscardError(`Couldn't discard: ${msg}. Try again.`);
    }
  }

  const isPractice = gameType === 'practice';
  const count = isPractice ? 1 : playerCount;
  // Shark mode is the 1-player flavor of 8-ball — no solids/stripes,
  // every miss/foul lets the invisible Shark steal a ball.
  const isShark = gameType === '8ball' && playerCount === 1;

  // 9-Ball has no solo/Shark variant. If the user is on Shark (1P) and
  // switches to 9-Ball, bump them to Singles (2P) so the player-count
  // selector doesn't show a stale/invalid selection.
  useEffect(() => {
    if (gameType === '9ball' && playerCount === 1) {
      setPlayerCount(2);
    }
  }, [gameType, playerCount]);

  // Keep the breaker selection in range. Switching Doubles → Singles, or to
  // Practice/Shark (solo), can leave breakerIndex pointing at a now-absent
  // slot — reset to slot 0 so the wrong (or missing) player can't be handed
  // the break.
  useEffect(() => {
    if (breakerIndex > count - 1) setBreakerIndex(0);
  }, [count, breakerIndex]);

  // Normalize manualTeams when entering Singles 8-ball manual mode. Doubles
  // legally allows duplicates (3v1 splits), so the user can land here with
  // both slot 0 and slot 1 on the same group after switching from Doubles
  // → Singles. Clear slot 1 in that case so the invalid pairing can't
  // survive a mode transition and get into handleStart.
  useEffect(() => {
    if (gameType !== '8ball' || playerCount !== 2 || teamMode !== 'manual') return;
    if (manualTeams[0] && manualTeams[0] === manualTeams[1]) {
      const t = [...manualTeams] as ('solids' | 'stripes' | '')[];
      t[1] = '';
      setManualTeams(t);
    }
  }, [gameType, playerCount, teamMode, manualTeams]);

  // Debounced @mention resolution for non-host slots (index >= 1). Watches the
  // editable names; whenever a slot starts with "@" and has a handle, it resolves
  // after a short delay. Slots that don't start with "@" reset to idle so a
  // stale "linked" badge can't linger after the host clears the mention.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < count; i++) {
      const raw = names[i] ?? '';
      if (!raw.startsWith('@')) {
        setMentions(prev => (prev[i] && prev[i].kind !== 'idle' ? { ...prev, [i]: { kind: 'idle' } } : prev));
        continue;
      }
      const handle = raw.slice(1).trim();
      if (!handle) {
        setMentions(prev => (prev[i] && prev[i].kind !== 'idle' ? { ...prev, [i]: { kind: 'idle' } } : prev));
        continue;
      }
      setMentions(prev => ({ ...prev, [i]: { kind: 'checking' } }));
      const reqId = (mentionReqId.current[i] ?? 0) + 1;
      mentionReqId.current[i] = reqId;
      const t = setTimeout(async () => {
        try {
          const r = await resolveMention({ name: handle });
          if (mentionReqId.current[i] !== reqId) return;
          if (!r.eligible) setMentions(prev => ({ ...prev, [i]: { kind: 'pass_required' } }));
          else if (!r.found) setMentions(prev => ({ ...prev, [i]: { kind: 'notfound' } }));
          else if (r.atCap) setMentions(prev => ({ ...prev, [i]: { kind: 'atcap' } }));
          else setMentions(prev => ({ ...prev, [i]: { kind: 'found', screenName: r.screenName ?? handle } }));
        } catch {
          if (mentionReqId.current[i] !== reqId) return;
          setMentions(prev => ({ ...prev, [i]: { kind: 'idle' } }));
        }
      }, 350);
      timers.push(t);
    }
    return () => timers.forEach(clearTimeout);
  }, [names, count]);

  async function handleStart() {
    setStartError('');
    // Defensive guard: in Singles 8-ball manual mode the two players must
    // be on opposite groups. The dropdown UI already enforces this on
    // change, but a mode transition (e.g. Doubles → Singles) could in
    // theory leave a stale duplicate in state — refuse to start in that
    // case rather than handing GameScreen an invalid pairing.
    if (gameType === '8ball' && !isShark && teamMode === 'manual' && count === 2 &&
        manualTeams[0] && manualTeams[0] === manualTeams[1]) {
      setStartError('Players must be on opposite groups (Solids vs Stripes).');
      return;
    }
    // Collect resolved @mentions for non-host slots and pin those slots' player
    // names to the canonical screen name so the shot log attributes correctly
    // (shotLog playerName must equal the invite's displayName).
    const mentionPayload: { slotIndex: number; screenName: string }[] = [];
    const players: Player[] = Array.from({ length: count }, (_, i) => {
      // Signed-out users can't name players or @mention — every slot is
      // pinned to its "Player N" default, ignoring any stale state in
      // `names[]` (e.g. typed while signed in, then signed out without remount).
      if (isSignedOut) {
        const p: Player = { id: i, name: SIGNED_OUT_NAMES[i] };
        if (gameType === '8ball' && !isShark && teamMode === 'manual' && manualTeams[i]) {
          p.team = manualTeams[i] as 'solids' | 'stripes';
        }
        return p;
      }
      const mention = i >= 1 ? mentions[i] : undefined;
      const linkedName = mention?.kind === 'found' ? mention.screenName : null;
      if (linkedName) mentionPayload.push({ slotIndex: i, screenName: linkedName });
      // Sanitize the typed name (strip control/URL/markup + blocked words, cap
      // length) as a safety net in case the field wasn't blurred. @mention/locked
      // names are canonical screen names already filtered server-side, so only
      // the free-typed slot is cleaned.
      const typedName = sanitizePlayerName(names[i] ?? '', bannedWords);
      const p: Player = { id: i, name: linkedName ?? (typedName || DEFAULT_NAMES[i]) };
      // Manual team assignment is only relevant for multiplayer 8-ball.
      if (gameType === '8ball' && !isShark && teamMode === 'manual' && manualTeams[i]) {
        p.team = manualTeams[i] as 'solids' | 'stripes';
      }
      return p;
    });
    // Resolve the Chaos/None play mode (multiplayer 8-ball only). Chaos uses
    // the selected win rule; None has no winner; auto/manual leave it undefined.
    const chaosMode: ChaosMode | undefined =
      gameType === '8ball' && !isShark
        ? teamMode === 'chaos'
          ? chaosRule
          : teamMode === 'none'
            ? 'none'
            : undefined
        : undefined;
    try {
      // Server enum only knows '8ball'/'9ball'/'practice'; shark is a
      // client-side variant of 8-ball, so the API call stays as '8ball'.
      const res = await startGame.mutateAsync({
        data: {
          gameType,
          maxPlayers: count,
          ...(mentionPayload.length > 0 ? { mentions: mentionPayload } : {}),
        },
      });
      onStart(
        gameType,
        players,
        res.gameId ?? null,
        res.maxGameDurationMs ?? null,
        res.shareCode ?? null,
        isShark ? sharkAggression : undefined,
        // Rule set drives group assignment for solos/stripes 8-ball. Shark is
        // solo 8-ball and always plays Open Table (balls on the break don't
        // lock a group; the next pocket after the break does). Auto 2P/4P use
        // the chosen rule. Manual teams pre-assign; Practice/Chaos/None have none.
        isShark
          ? 'open-through-break'
          : gameType === '8ball' && teamMode === 'auto'
            ? ruleSet
            : undefined,
        chaosMode,
        // Who breaks. Solo modes (Practice/Shark) only ever have slot 0; the
        // clamp effect keeps breakerIndex valid for the active count.
        count >= 2 ? breakerIndex : 0,
        // Rack size only matters for Practice; other modes ignore it.
        isPractice ? practiceRack : undefined,
      );
    } catch (e: unknown) {
      const err = e as { data?: { error?: string } };
      setStartError(err?.data?.error ?? (e instanceof Error ? e.message : 'Could not start game'));
    }
  }

  function handleJoin() {
    const code = normalizeShareCode(joinCode);
    if (!code) {
      setStartError('Codes are 5 characters (letters & digits, no 0/1/I/O).');
      return;
    }
    setLocation(`/join/${code}`);
  }

  function setName(i: number, v: string) {
    const n = [...names]; n[i] = v; setNames(n);
  }
  function setTeam(i: number, v: string) {
    const t = [...manualTeams] as ('solids' | 'stripes' | '')[];
    t[i] = v as 'solids' | 'stripes';
    // Singles 8-ball: the two players must be on opposite groups. If the
    // other slot already holds the value we just picked, clear it so the
    // user is forced to re-pick (rather than silently flipping their
    // group). Doubles (4P) deliberately allows duplicates — 3v1 splits.
    if (count === 2 && v) {
      const other = i === 0 ? 1 : 0;
      if (t[other] === v) t[other] = '';
    }
    setManualTeams(t);
  }

  return (
    // app-window--page: lets the whole document scroll (splash + body
    // together) instead of trapping scroll inside .app-body. The navbar
    // stays sticky at the top. Matches the Account/About/Passes screens
    // so the splash panel scrolls away on mobile when the keyboard
    // appears for player-name input.
    <div className="app-window app-window--page">
      {/* Title bar */}
      <Navbar onAbout={onAbout} onAccount={onAccount} onStats={onStats} onFindPlayers={onFindPlayers} onSignIn={onSignIn} />
      {/* ── PC-98 Splash Panel ── */}
      <div className="splash-panel">
        {/* Left: 8-ball art in a CRT-style frame.
            Press-and-hold (3s) reveals the share QR easter egg. */}
        <div
          className="splash-art-frame"
          onPointerDown={startQrPress}
          onPointerUp={clearQrPress}
          onPointerLeave={clearQrPress}
          onPointerCancel={clearQrPress}
          onContextMenu={e => e.preventDefault()}
          style={{
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            touchAction: 'manipulation',
          } as React.CSSProperties}
        >
          {showQr ? (
            <div
              style={{ background: '#fff', padding: 6, lineHeight: 0, borderRadius: 2 }}
              aria-label={`QR code to ${qrUrl}`}
            >
              <QRCodeSVG value={qrUrl} size={104} level="M" />
            </div>
          ) : (
            <img src={ballImg} alt="8-ball" className="splash-ball-img" draggable={false} />
          )}
        </div>

        {/* Right: title block */}
        <div className="splash-title-block">
          <h1 className="splash-title-main">BREAK<span className="splash-title-accent">BPM</span></h1>
          <div className="splash-title-sub">BILLIARDS SCORE TRACKER &amp; STATS</div>
          <div className="splash-title-rule" />
          <div className="splash-meta">
            <span>v{APP_VERSION}</span>
            <span>©Saym Services 2026</span>
          </div>
          <div className="splash-tagline text-left">
            {tagline.split('\n').map((line, i, arr) => (
              <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
            ))}
          </div>
        </div>
      </div>
      {/* ── Menu body ── */}
      <div className="app-body pb-[10px]">

        {/* Resume in-progress game (signed-in users whose localStorage was
            cleared — different device, new browser, etc.) */}
        {!resumeDismissed && resumable.data?.resumable && resumable.data.game && (() => {
          const offered = resumable.data.game;
          const gs = (offered.gameState ?? {}) as Partial<GameState>;
          // "Degraded" means we'd have to rehydrate with placeholder players
          // because the server snapshot is incomplete or malformed. Mirror
          // the same validation handleResume() uses so the UI never claims
          // "Resume game in progress?" when names will actually be lost.
          const rawPlayers = Array.isArray(gs.players) ? gs.players : [];
          const allValid = rawPlayers.length > 0 && rawPlayers.every(p =>
            !!p && typeof p === 'object' && typeof (p as Player).id === 'number' && typeof (p as Player).name === 'string',
          );
          const degraded = !allValid;
          return (
          <div className="notice" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div>
              <strong>{degraded ? "Couldn't fully restore this game" : 'Resume game in progress?'}</strong>
              <div style={{ fontSize: 11, marginTop: 2, opacity: 0.8 }}>
                {offered.gameType.toUpperCase()} — started {new Date(offered.startedAt).toLocaleString()}
              </div>
              {degraded && (
                <div style={{ fontSize: 11, marginTop: 4, color: '#c70' }}>
                  Player names couldn't be recovered. Resume with placeholders, or start fresh.
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleResume}>
                {degraded ? '▶ Resume anyway' : '▶ Resume'}
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleDiscardResume} disabled={abandonGame.isPending}>
                {abandonGame.isPending ? '…' : 'Start fresh'}
              </button>
            </div>
            {discardError && (
              <div style={{ color: '#c33', fontSize: 11 }}>{discardError}</div>
            )}
          </div>
          );
        })()}

        {/* Game type */}
        <div>
          <h2 className="menu-section-label">▶ GAME TYPE</h2>
          <div className="game-type-grid">
            {GAME_TYPES.map(gt => (
              <button
                key={gt.id}
                className={`btn type-btn ${gameType === gt.id ? 'selected' : ''}`}
                onClick={() => { setGameType(gt.id); if (gt.id === 'practice') setPlayerCount(1); }}
              >
                <span className="type-btn-label">{gt.label}</span>
                <span className="type-btn-desc">{gt.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Player count */}
        {!isPractice && <hr className="sep mt-[1px] mb-[1px]" />}
        {!isPractice && (
          <div>
            <div className="flex gap-1">
              {(gameType === '9ball' ? [2, 4] : [1, 2, 4]).map(n => (
                <button
                  key={n}
                  className={`btn ${playerCount === n ? 'selected' : ''}`}
                  style={{ flex: 1, fontSize: 13, fontWeight: 'bold', minHeight: 44 }}
                  onClick={() => setPlayerCount(n)}
                >
                  {n === 1 ? 'Shark Mode • 挑战' : n === 2 ? 'Singles • 单人' : 'Doubles • 双人'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Player names — hidden in Shark Mode (solo) and in Practice when
            already signed in (name is locked, no need to show it). */}
        {!isShark && !(isPractice && (lockedPlayer1Name !== null || isSignedOut)) && (<div>
          <h2 className="menu-section-label">▶ {isPractice ? 'YOUR NAME' : 'PLAYERS'}</h2>
          {count >= 2 && (
            <div style={{ fontSize: 11, color: '#444', margin: '-2px 0 4px' }}>Select who breaks</div>
          )}
          <div className="flex flex-col gap-2">
            {Array.from({ length: count }).map((_, i) => {
              // Slot 1 is locked to the signed-in user so they can't
              // play under someone else's name and skew their stats.
              const isLockedSlot = i === 0 && lockedPlayer1Name !== null;
              // Signed-out users can't edit any slot — every field is pinned
              // to its "Player N" default. Both states share the read-only
              // styling/cursor; only the tooltip and value differ.
              const isNameLocked = isLockedSlot || isSignedOut;
              const slotDisplayName = isLockedSlot
                ? lockedPlayer1Name!
                : isSignedOut
                  ? SIGNED_OUT_NAMES[i]
                  : (names[i] || DEFAULT_NAMES[i]);
              return (
                <div key={i} className="player-row">
                  {count >= 2 ? (
                    // Multiplayer: the leading ball doubles as a radio that picks
                    // who breaks. Selected → white cue ball; unselected → that
                    // player's numbered colour ball. (Don't add `hud-chip` to the
                    // cue ball — its ::after would paint a stray white dot over it.)
                    (<label
                      className="breaker-opt"
                      title={`${slotDisplayName} breaks first`}
                    >
                      <input
                        type="radio"
                        name="breaker"
                        checked={breakerIndex === i}
                        onChange={() => setBreakerIndex(i)}
                        className="rule-set-radio"
                        // The visible label is aria-hidden ball art, so name the
                        // radio explicitly for screen readers / AT.
                        aria-label={`${slotDisplayName} breaks first`}
                      />
                      {breakerIndex === i ? (
                        <span className="cue-ball-icon cue-ball-icon--chip" aria-hidden="true" />
                      ) : (
                        <span
                          className="hud-chip hud-chip-solid"
                          data-number={i + 1}
                          aria-hidden="true"
                          style={{ '--chip-color': PLAYER_BALL_COLORS[i] } as React.CSSProperties}
                        />
                      )}
                    </label>)
                  ) : (
                    <span
                      className="hud-chip hud-chip-solid"
                      data-number={i + 1}
                      aria-hidden="true"
                      style={{ '--chip-color': PLAYER_BALL_COLORS[i] } as React.CSSProperties}
                    />
                  )}
                  <input
                    className="input"
                    value={
                      isLockedSlot
                        ? (canMention ? `@${lockedPlayer1Name}` : lockedPlayer1Name)
                        : isSignedOut
                          ? SIGNED_OUT_NAMES[i]
                          : names[i]
                    }
                    onChange={e => setName(i, e.target.value)}
                    onBlur={() => {
                      // Sanitize once the user leaves the field (strip control/
                      // URL/markup + blocked words, cap length) so the cleaned
                      // name is visible and is what gets used.
                      if (!isNameLocked) setName(i, sanitizePlayerName(names[i] ?? '', bannedWords));
                    }}
                    placeholder={DEFAULT_NAMES[i]}
                    maxLength={MAX_PLAYER_NAME_LENGTH}
                    readOnly={isNameLocked}
                    aria-readonly={isNameLocked || undefined}
                    title={
                      isLockedSlot
                        ? 'Signed in — name locked to your account'
                        : isSignedOut
                          ? 'Sign in to set player names'
                          : undefined
                    }
                    style={
                      isNameLocked
                        ? { background: 'var(--silver)', color: '#555', cursor: 'not-allowed' }
                        : undefined
                    }
                  />
                  {gameType === '8ball' && !isShark && teamMode === 'manual' && (() => {
                    // Singles only: hide the group the other player has
                    // already claimed so both players can't end up on the
                    // same team. Doubles keeps both options for everyone
                    // so 3v1 / 2v2 / 4v0 splits remain possible.
                    const takenByOther = count === 2
                      ? manualTeams[i === 0 ? 1 : 0]
                      : '';
                    return (
                      <select
                        className="input"
                        // Fixed width sized for the longer label "Stripes (9-15)"
                        // so the dropdown doesn't shrink when "Stripes" is hidden
                        // (because the other player took it). Keeps both rows
                        // visually aligned.
                        style={{ width: 130, flex: '0 0 auto' }}
                        value={manualTeams[i]}
                        onChange={e => setTeam(i, e.target.value)}
                      >
                        <option value="">-Select-</option>
                        {takenByOther !== 'solids' && (
                          <option value="solids">Solids (1-7)</option>
                        )}
                        {takenByOther !== 'stripes' && (
                          <option value="stripes">Stripes (9-15)</option>
                        )}
                      </select>
                    );
                  })()}
                  {/* Live @mention status (non-host slots only). */}
                  {i >= 1 && !isNameLocked && (() => {
                    const st = mentions[i];
                    if (!st || st.kind === 'idle') return null;
                    const map: Record<Exclude<MentionState['kind'], 'idle'>, { text: string; color: string }> = {
                      checking: { text: '…', color: '#555' },
                      found: { text: '🟢 Player Found :)', color: '#0a7d2c' },
                      notfound: { text: '🔴 Not Found :(', color: '#b00020' },
                      atcap: { text: 'Invite List Full :(', color: '#b00020' },
                      pass_required: { text: 'Pass Required', color: '#9a6b00' },
                    };
                    const m = map[st.kind];
                    return (
                      <span
                        style={{ fontSize: 11, fontWeight: 'bold', color: m.color, flex: '0 0 auto', whiteSpace: 'nowrap' }}
                      >
                        {m.text}
                      </span>
                    );
                  })()}
                </div>
              );
            })}
          </div>
          {/* Signed-out users can't name players — nudge them to sign in.
              Occupies the same spot as the paid-host @USERNAME tip below. */}
          {isSignedOut && (
            <div style={{ fontSize: 11, color: '#444', marginTop: 4, paddingLeft: 34 }}>
              <strong>Sign in</strong> to set player names.
            </div>
          )}
          {/* Discoverability hint for paid hosts — links a registered player by
              handle without a join code. Shown only for multiplayer setups. */}
          {!isSignedOut && canMention && count >= 2 && !isShark && (
            <div style={{ fontSize: 11, color: '#444', marginTop: 4, paddingLeft: 34 }}>
              Tip: <strong>@USERNAME</strong> to add another registered player.
            </div>
          )}

          {gameType === '8ball' && !isPractice && !isShark && (
            <div
              className="inset"
              style={{
                marginTop: 10,
                padding: '6px 10px',
                background: 'var(--silver)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, flex: 1 }}>
                  <span style={{ fontWeight: 'bold', fontSize: 13 }}>Format</span>
                  <span style={{ fontSize: 11, color: '#444' }}>
                    {teamMode === 'auto' ? RULE_SET_SUBLABEL[ruleSet] : TEAM_MODE_SUBLABEL[teamMode]}
                  </span>
                </span>
                {/* Single 4-state cycling toggle: On → Off → None → Chaos. */}
                <div className="flex gap-1" style={{ flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btn selected"
                    style={{ minWidth: 88, minHeight: 32, fontWeight: 'bold' }}
                    onClick={() =>
                      setTeamMode(
                        m => TEAM_MODE_CYCLE[(TEAM_MODE_CYCLE.indexOf(m) + 1) % TEAM_MODE_CYCLE.length],
                      )
                    }
                    aria-label={`Format: ${TEAM_MODE_LABEL[teamMode]}. Tap to cycle.`}
                  >
                    {TEAM_MODE_LABEL[teamMode]} ▸
                  </button>
                </div>
              </div>
              {/* On/Off: the Rule Set radios show for auto play only. */}
              {teamMode === 'auto' && (
                <div style={{ marginTop: 6 }}>
                  <div
                    role="radiogroup"
                    aria-label="Group assignment rule set"
                    style={{ display: 'flex', gap: 6 }}
                    className="pt-[2px] pb-[2px]">
                    {RULE_SET_OPTIONS.map(opt => {
                      const checked = ruleSet === opt.value;
                      return (
                        <label
                          key={opt.value}
                          className={`rule-set-opt ${checked ? 'selected' : ''}`}
                          title={opt.label}
                        >
                          <input
                            type="radio"
                            name="ruleSet"
                            value={opt.value}
                            checked={checked}
                            onChange={() => setRuleSet(opt.value)}
                            className="rule-set-radio"
                          />
                          <span
                            className={`rule-set-indicator ${checked ? 'cue-ball-icon' : ''}`}
                            aria-hidden="true"
                          />
                          <span className="rule-set-chips" aria-hidden="true">
                            {opt.chips.map((chip, i) => (
                              <span
                                key={i}
                                className={`hud-chip hud-chip-sm ${chip.chipClass}`}
                                data-number={chip.number}
                                style={{ '--chip-color': chip.chipColor } as React.CSSProperties}
                              />
                            ))}
                          </span>
                          <span className="rule-set-label">{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Chaos: no teams. The Win Rule radios decide how the 8 wins. */}
              {teamMode === 'chaos' && (
                <div
                  style={{
                    marginTop: 6,
                    paddingTop: 6,
                    borderTop: '1px solid rgba(0,0,0,0.18)',
                  }}
                >
                  <span style={{ fontWeight: 'bold', fontSize: 13, display: 'block', marginBottom: 6 }}>
                    Win Rule
                  </span>
                  <div
                    role="radiogroup"
                    aria-label="Chaos win rule"
                    style={{ display: 'flex', gap: 6 }}
                  >
                    {CHAOS_RULE_OPTIONS.map(opt => {
                      const checked = chaosRule === opt.value;
                      return (
                        <label
                          key={opt.value}
                          className={`rule-set-opt ${checked ? 'selected' : ''}`}
                          title={opt.label}
                        >
                          <input
                            type="radio"
                            name="chaosRule"
                            value={opt.value}
                            checked={checked}
                            onChange={() => setChaosRule(opt.value)}
                            className="rule-set-radio"
                          />
                          <span
                            className={`rule-set-indicator ${checked ? 'cue-ball-icon' : ''}`}
                            aria-hidden="true"
                          />
                          <span className="rule-set-chips" aria-hidden="true">
                            {opt.cueBall && (
                              <span className="rainbow-cue" style={{ fontSize: 18 }} />
                            )}
                            {opt.chips.map((chip, i) => (
                              <span
                                key={i}
                                className={`hud-chip hud-chip-sm ${chip.chipClass}`}
                                data-number={chip.number}
                                style={{ '--chip-color': chip.chipColor } as React.CSSProperties}
                              />
                            ))}
                          </span>
                          <span className="rule-set-label">{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                  <span style={{ display: 'block', fontSize: 10, color: '#444', marginTop: 6 }}>
                    {chaosRule === 'eight-last'
                      ? 'Sink the 8 last to win or early to lose.'
                      : 'Anything goes. Clear the table; whoever sank the most wins.'}
                  </span>
                </div>
              )}
              {/* None: no teams, no winner, no rules — panel stays blank. */}
            </div>
          )}
        </div>)}

        {isPractice && (
          <div>
            <h2 className="menu-section-label">▶ RACK</h2>
            <div className="flex gap-1">
              <button
                className={`btn ${practiceRack === '8ball' ? 'selected' : ''}`}
                style={{ flex: 1, fontWeight: 'bold', minHeight: 40 }}
                onClick={() => setPracticeRack('8ball')}
              >
                8-Ball • 练习
                <span style={{ display: 'block', fontWeight: 'normal', fontSize: 10, marginTop: 2 }}>(1–15)</span>
              </button>
              <button
                className={`btn ${practiceRack === '9ball' ? 'selected' : ''}`}
                style={{ flex: 1, fontWeight: 'bold', minHeight: 40 }}
                onClick={() => setPracticeRack('9ball')}
              >
                9-Ball • 练习
                <span style={{ display: 'block', fontWeight: 'normal', fontSize: 10, marginTop: 2 }}>(1–9)</span>
              </button>
            </div>
            <div className="notice" style={{ marginTop: 8 }}>
              <span>ℹ</span>
              <span>Solo, no win conditions. Track every shot.</span>
            </div>
          </div>
        )}

        {isShark && (
          <div>
            <h2 className="menu-section-label">▶ SHARK MODE</h2>
            <div className="notice" style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 11 }}>Solo 8-ball with an invisible Shark player. Your first ball locks in solids or stripes; the other group goes to the Shark. Clear your group and sink the 8 ball to win. Misses and/or fouls feed balls to the Shark.</span>
            </div>
            <h2 className="menu-section-label" style={{ marginTop: 4 }}>▶ AGGRESSION</h2>
            <div className="flex gap-1">
              <button
                className={`btn ${sharkAggression === 'normal' ? 'selected' : ''}`}
                style={{ flex: 1, fontWeight: 'bold', minHeight: 40 }}
                onClick={() => setSharkAggression('normal')}
              >
                Normal
                <span style={{ display: 'block', fontWeight: 'normal', fontSize: 10, marginTop: 2 }}>Removes on foul</span>
              </button>
              <button
                className={`btn ${sharkAggression === 'hard' ? 'selected' : ''}`}
                style={{ flex: 1, fontWeight: 'bold', minHeight: 40 }}
                onClick={() => setSharkAggression('hard')}
              >
                Hard
                <span style={{ display: 'block', fontWeight: 'normal', fontSize: 10, marginTop: 2 }}>Removes on miss & foul</span>
              </button>
            </div>
          </div>
        )}

        {/* Start */}
        {startError && (
          <div className="notice" style={{ color: '#c00' }}>
            <span>!</span><span>{startError}</span>
          </div>
        )}
        <button
          className="btn btn-primary btn-big btn-full"
          onClick={handleStart}
          disabled={startGame.isPending}
          style={{ padding: '8px 15px' }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span>
              <span className="cue-ball-icon" aria-hidden="true" style={{ marginRight: 6 }} />
              {startGame.isPending ? 'STARTING…' : 'BREAK!'}
            </span>
            {isSignedOut && !startGame.isPending && (
              <span style={{ fontWeight: 'normal', fontSize: 10, marginTop: 2 }}>
                You're not signed in, no data will be saved :(
              </span>
            )}
          </span>
        </button>

        <hr className="sep" />

        {/* Join shared game — collapsible panel.
            Header mirrors AccountScreen's Recent Games panel (icon + label).
            Body (input + Join button) is mounted only when expanded so the
            input is fully removed from tab order / autofocus when closed. */}
        <div className="panel">
          <button
            type="button"
            className="panel-header"
            onClick={() => setJoinOpen(o => !o)}
            aria-expanded={joinOpen}
            aria-controls="join-shared-body"
            style={{
              width: '100%',
              border: 'none',
              cursor: 'pointer',
              font: 'inherit',
              textAlign: 'left',
            }}
          >
            <span
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              className="justify-start items-center flex-row text-left text-[13px] font-semibold text-[#ffffff]">
              JOIN GAME • 加入
            </span>
            <span aria-hidden="true" className="text-[#000000]">{joinOpen ? '▼' : '▶'}</span>
          </button>
          {joinOpen && (
            <div className="panel-body" id="join-shared-body">
              <div className="flex gap-2 items-center">
                <input
                  className="input"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="5-CHAR CODE"
                  maxLength={5}
                  style={{ fontFamily: "'VT323',monospace", fontSize: 20, letterSpacing: 6, flex: 1 }}
                />
                <button
                  className="btn"
                  onClick={handleJoin}
                  disabled={joinCode.trim().length < 1}
                  style={{ flexShrink: 0 }}
                >
                  Join →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 30-day top-shooters leaderboard — visible to everyone. */}
        <LeaderboardWidget />

      </div>
      {/* Status bar */}
      <div className="statusbar">
        <div className="statusbar-item" style={{ flex: 1 }}>READY</div>
        <a href="/legal" className="statusbar-item statusbar-link" onClick={(e) => { e.preventDefault(); onLegal(); }}>LEGAL</a>
        <div className="statusbar-item"><a href="https://github.com/ThatOtherZach/BreakBPM" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>BREAKBPM SYS v{APP_VERSION}</a></div>
      </div>
    </div>
  );
}
