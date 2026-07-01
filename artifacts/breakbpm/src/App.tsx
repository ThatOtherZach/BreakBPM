import { useState, useEffect, useRef } from "react";
import { Switch, Route, useLocation, useSearch, Router as WouterRouter } from "wouter";
import { clampObsScale } from "./components/ObsOverlay";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";

import SetupScreen from "./components/SetupScreen";
import GameScreen from "./components/GameScreen";
import JoinedGameScreen from "./components/JoinedGameScreen";
import WatchByNameScreen from "./components/WatchByNameScreen";
import AboutScreen from "./components/AboutScreen";
import LegalScreen from "./components/LegalScreen";
import AccountScreen from "./components/AccountScreen";
import StatsScreen from "./components/StatsScreen";
import LeaderboardScreen from "./components/LeaderboardScreen";
import FindPlayersScreen from "./components/FindPlayersScreen";
import PassesScreen from "./components/PassesScreen";
import RedeemScreen from "./components/RedeemScreen";
import InviteScreen from "./components/InviteScreen";
import ClaimScreen from "./components/ClaimScreen";
import PoolStatsAppScreen from "./components/PoolStatsAppScreen";
import ForVenuesScreen from "./components/ForVenuesScreen";
import { SignInPage, SignUpPage } from "./components/SignInPage";
import { readPendingRedeem } from "./lib/pendingRedeem";
import { readPendingClaim } from "./lib/pendingClaim";
import { readPendingInvite } from "./lib/pendingInvite";
import type { GameType, GameState, Player, SharkAggression, RuleSet, ChaosMode, PracticeRack, RematchConfig, GameMention } from "./lib/gameLogic";
import {
  generateShareCode,
  decodeGameState,
  loadInProgressGame,
  clearInProgressGame,
  normalizeSharkIdentity,
} from "./lib/gameLogic";
import { queryClient } from "./lib/queryClient";
import { useGoBack } from "./lib/navHistory";
import { AuthProvider, useAuth } from "./lib/authClient";
import { useAbandonGame, useStartGame } from "@workspace/api-client-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

type AppView = "setup" | "game" | "about" | "account" | "passes";

function loadStateFromUrl(): Partial<GameState> | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("state");
    if (encoded) return decodeGameState(encoded);
  } catch {}
  return null;
}

function createInitialGameState(
  gameType: GameType,
  players: Player[],
  serverShareCode: string | null,
  sharkAggression?: SharkAggression,
  ruleSet?: RuleSet,
  chaosMode?: ChaosMode,
  breakerIndex?: number,
  practiceRack?: PracticeRack,
  mentions?: GameMention[],
): GameState {
  // Shark mode is solo 8-ball with an opponent steal mechanic. Only seed
  // the shark fields when the combo actually matches — keeps state shape
  // clean for the 99% of games that aren't shark.
  const isShark = gameType === "8ball" && players.length === 1 && sharkAggression !== undefined;
  // Clamp the requested breaker into range so a bad index can't point past
  // the players array. Defaults to slot 0 (Player 1) — the historical behavior.
  const safeBreaker =
    typeof breakerIndex === "number" && Number.isFinite(breakerIndex)
      ? Math.max(0, Math.min(players.length - 1, Math.floor(breakerIndex)))
      : 0;
  return {
    phase: "playing",
    gameType,
    players,
    currentPlayerIndex: safeBreaker,
    sunkBalls: [],
    shotLog: [],
    gameStartTime: Date.now(),
    firstActionTime: null,
    timerStartTime: null,
    lastActionTime: null,
    winner: null,
    winMessage: "",
    shareCode: serverShareCode ?? generateShareCode(),
    teamAssigned: players.some((p) => p.team !== undefined),
    sharkAggression: isShark ? sharkAggression : undefined,
    sharkSunkBalls: isShark ? [] : undefined,
    ruleSet,
    chaosMode,
    // Rack size only applies to Practice; leave it unset for other modes so
    // the state shape stays clean.
    practiceRack: gameType === "practice" ? practiceRack : undefined,
    // Remember who broke so a Rematch can fall back to the original breaker
    // when the finished game had no winner to inherit the break.
    breakerIndex: safeBreaker,
    // Persist @mention links so a Rematch can re-attach the same players.
    mentions: mentions && mentions.length > 0 ? mentions : undefined,
    undoCount: 0,
  };
}

/**
 * When the signed-in user changes, blow away the cache so /auth/me and
 * /games/history queries don't leak across accounts.
 */
function CacheInvalidator() {
  const { isAuthenticated, isLoading } = useAuth();
  const qc = useQueryClient();
  const prev = useRef<boolean | null>(null);
  useEffect(() => {
    if (isLoading) return;
    if (prev.current !== null && prev.current !== isAuthenticated) qc.clear();
    prev.current = isAuthenticated;
  }, [isAuthenticated, isLoading, qc]);
  return null;
}

/**
 * Watches for a stashed intent left before the sign-up/sign-in redirect and,
 * once the user is authenticated, bounces them to the page that completes it:
 *   - a redeem code (from RedeemScreen) → `/redeem/:code`
 *   - a free-pass claim (from ClaimScreen / the landing CTA) → `/claim`
 * Those screens own the actual work + clearing the stash, so this only
 * navigates. Redeem takes precedence if both somehow exist.
 */
function RedeemResumer() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location, setLocation] = useLocation();
  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    // Only act on the auth-return entrypoint ("/"), so we never pull a user
    // off /join, /watch, /account, or an in-flight /redeem page.
    if (location !== "/") return;
    // A `?code=`/`?game=` join link is handled by MainApp — defer to it rather
    // than hijacking the join into a redeem.
    const params = new URLSearchParams(window.location.search);
    if (params.get("code") || params.get("game")) return;
    const pending = readPendingRedeem();
    if (pending) {
      setLocation(`/redeem/${encodeURIComponent(pending)}`);
      return;
    }
    const pendingInvite = readPendingInvite();
    if (pendingInvite) {
      setLocation(`/invite/${encodeURIComponent(pendingInvite)}`);
      return;
    }
    if (readPendingClaim()) setLocation("/claim");
  }, [isAuthenticated, isLoading, location, setLocation]);
  return null;
}

function MainApp() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  // Share-link entry points. Anything with `?code=<X>` (current) or the
  // legacy `?game=<X>` redirects to the canonical `/join/:code` route
  // so recipients always land in the read-only joiner view, regardless
  // of how they got the link.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("code") ?? params.get("game");
      if (raw) {
        const code = raw.trim().toUpperCase();
        if (code) {
          setLocation(`/join/${code}`);
        }
      }
    } catch { /* noop */ }
    // setLocation is stable; we only want this on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [view, setView] = useState<AppView>("setup");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const abandonGame = useAbandonGame();
  const startGame = useStartGame();
  // Server-issued in-progress game id (signed-in users only). Held outside
  // the URL-shared GameState so it isn't leaked via share links.
  const [serverGameId, setServerGameId] = useState<string | null>(null);
  // Hard wall-clock cap for anonymous play (server returns 1 hr); null
  // for signed-in users.
  const [maxGameDurationMs, setMaxGameDurationMs] = useState<number | null>(null);
  // Pause accumulator carried over from a restored in-progress game (so the
  // elapsed clock stays accurate across refresh). 0 for fresh games.
  const [initialPausedDuration, setInitialPausedDuration] = useState(0);

  useEffect(() => {
    // Primary recovery path: localStorage holds the full in-progress game
    // (including shotLog and the server-issued gameId) so a refresh, tab
    // close, or connection drop can resume the exact same game.
    const persisted = loadInProgressGame();
    if (persisted) {
      normalizeSharkIdentity(persisted.state);
      setGameState(persisted.state);
      setServerGameId(persisted.serverGameId);
      setMaxGameDurationMs(persisted.maxGameDurationMs);
      setInitialPausedDuration(persisted.pausedDuration ?? 0);
      setView("game");
      return;
    }
    // Fallback: legacy URL-encoded share links. Lossy for shotLog/serverGameId
    // but kept so old `?state=` links still open something playable.
    const restored = loadStateFromUrl();
    if (restored && restored.phase && restored.players && restored.players.length > 0) {
      normalizeSharkIdentity(restored);
      setGameState({
        phase: restored.phase!,
        gameType: restored.gameType ?? "8ball",
        players: restored.players ?? [],
        currentPlayerIndex: restored.currentPlayerIndex ?? 0,
        sunkBalls: restored.sunkBalls ?? [],
        shotLog: restored.shotLog ?? [],
        gameStartTime: restored.gameStartTime ?? Date.now(),
        firstActionTime: restored.firstActionTime ?? null,
        timerStartTime: restored.timerStartTime ?? null,
        lastActionTime: restored.lastActionTime ?? null,
        winner: restored.winner ?? null,
        winMessage: restored.winMessage ?? "",
        shareCode: restored.shareCode ?? generateShareCode(),
        teamAssigned: restored.teamAssigned ?? false,
        // Preserve shark identity across legacy ?state= share links.
        sharkAggression: restored.sharkAggression,
        sharkSunkBalls: restored.sharkSunkBalls,
        ruleSet: restored.ruleSet,
        chaosMode: restored.chaosMode,
        practiceRack: restored.practiceRack,
        breakerIndex: restored.breakerIndex,
        mentions: restored.mentions,
        undoCount: restored.undoCount ?? 0,
      });
      setView("game");
    }
  }, []);

  function handleStart(
    gameType: GameType,
    players: Player[],
    gameId: string | null,
    maxMs: number | null,
    serverShareCode: string | null,
    sharkAggression?: SharkAggression,
    ruleSet?: RuleSet,
    chaosMode?: ChaosMode,
    breakerIndex?: number,
    practiceRack?: PracticeRack,
    mentions?: GameMention[],
  ) {
    // Explicit fresh start — wipe any stale in-progress checkpoint so we
    // don't immediately resurrect the previous game on the next mount.
    clearInProgressGame();
    setGameState(createInitialGameState(gameType, players, serverShareCode, sharkAggression, ruleSet, chaosMode, breakerIndex, practiceRack, mentions));
    setServerGameId(gameId);
    setMaxGameDurationMs(maxMs);
    setInitialPausedDuration(0);
    setView("game");
    const url = new URL(window.location.href);
    url.searchParams.delete("state");
    url.searchParams.delete("game");
    window.history.replaceState(null, "", url.toString());
  }
  /**
   * Resume an existing game (from the server-side `/games/resume` prompt).
   * Unlike handleStart, this preserves the full passed-in state — shotLog,
   * sunkBalls, currentPlayerIndex, timers, shareCode, etc — so the game
   * picks up exactly where it left off.
   */
  function handleResume(state: GameState, gameId: string | null, maxMs: number | null, pausedDuration: number) {
    setGameState(state);
    setServerGameId(gameId);
    setMaxGameDurationMs(maxMs);
    setInitialPausedDuration(pausedDuration);
    setView("game");
    const url = new URL(window.location.href);
    url.searchParams.delete("state");
    url.searchParams.delete("game");
    window.history.replaceState(null, "", url.toString());
  }
  function handleNewGame() {
    clearInProgressGame();
    if (serverGameId) {
      abandonGame.mutate({ data: { gameId: serverGameId } });
    }
    setGameState(null);
    setServerGameId(null);
    setMaxGameDurationMs(null);
    setInitialPausedDuration(0);
    setView("setup");
    const url = new URL(window.location.href);
    url.searchParams.delete("state");
    url.searchParams.delete("game");
    window.history.replaceState(null, "", url.toString());
  }
  /**
   * Start a Rematch — a fresh game reusing the just-finished game's mode,
   * players, and settings, with a brand-new server game / share code. The
   * just-finished game was already saved (its row is finalized), so there is
   * nothing to abandon. Throws on failure so the caller can surface a retry.
   */
  async function handleRematch(cfg: RematchConfig) {
    clearInProgressGame();
    // Re-attach @mention links so the associated players get invited to the
    // rematch too (server re-validates: paid host only, still-under-cap, etc).
    const mentions = cfg.mentions && cfg.mentions.length > 0 ? cfg.mentions : undefined;
    const res = await startGame.mutateAsync({
      data: {
        gameType: cfg.gameType,
        maxPlayers: cfg.maxPlayers,
        ...(mentions ? { mentions } : {}),
      },
    });
    setGameState(
      createInitialGameState(
        cfg.gameType,
        cfg.players,
        res.shareCode ?? null,
        cfg.sharkAggression,
        cfg.ruleSet,
        cfg.chaosMode,
        cfg.breakerIndex,
        cfg.practiceRack,
        mentions,
      ),
    );
    setServerGameId(res.gameId ?? null);
    setMaxGameDurationMs(res.maxGameDurationMs ?? null);
    setInitialPausedDuration(0);
    setView("game");
    const url = new URL(window.location.href);
    url.searchParams.delete("state");
    url.searchParams.delete("game");
    window.history.replaceState(null, "", url.toString());
  }

  const goSignIn = () => setLocation("/sign-in");
  const goManual = () => setLocation("/about");
  const goLegal = () => setLocation("/legal");
  const goAccount = () => setLocation("/account");
  const goStats = () => setLocation("/stats");
  const goFindPlayers = () => setLocation("/find-players");

  if (view === "game" && gameState) {
    return (
      <GameScreen
        key={gameState.shareCode}
        initialState={gameState}
        serverGameId={serverGameId}
        maxGameDurationMs={maxGameDurationMs}
        initialPausedDuration={initialPausedDuration}
        onNewGame={handleNewGame}
        onRematch={handleRematch}
        isAuthenticated={isAuthenticated}
        onManual={goManual}
        onAccount={goAccount}
        onStats={goStats}
        onFindPlayers={goFindPlayers}
        onSignIn={goSignIn}
      />
    );
  }
  return (
    <SetupScreen
      onStart={handleStart}
      onResume={handleResume}
      onManual={goManual}
      onLegal={goLegal}
      onAccount={goAccount}
      onStats={goStats}
      onFindPlayers={goFindPlayers}
      onSignIn={goSignIn}
    />
  );
}

function AccountRoute() {
  const [, setLocation] = useLocation();
  const goBack = useGoBack();
  return (
    <AccountScreen
      onBack={() => goBack("/")}
      onPasses={() => setLocation("/passes")}
      onManual={() => setLocation("/about")}
      onFindPlayers={() => setLocation("/find-players")}
      onStats={() => setLocation("/stats")}
      onLeaderboard={() => setLocation("/leaderboard")}
      onSignIn={() => setLocation("/sign-in")}
    />
  );
}

function StatsRoute() {
  const [, setLocation] = useLocation();
  const goBack = useGoBack();
  return (
    <StatsScreen
      onBack={() => goBack("/")}
      onManual={() => setLocation("/about")}
      onAccount={() => setLocation("/account")}
      onFindPlayers={() => setLocation("/find-players")}
      onSignIn={() => setLocation("/sign-in")}
      onPasses={() => setLocation("/passes")}
      onLeaderboard={() => setLocation("/leaderboard")}
    />
  );
}

function LeaderboardRoute() {
  const [, setLocation] = useLocation();
  const goBack = useGoBack();
  return (
    <LeaderboardScreen
      onBack={() => goBack("/")}
      onManual={() => setLocation("/about")}
      onAccount={() => setLocation("/account")}
      onFindPlayers={() => setLocation("/find-players")}
      onStats={() => setLocation("/stats")}
      onSignIn={() => setLocation("/sign-in")}
    />
  );
}

function HallLeaderboardRoute({ params }: { params: { venueId: string } }) {
  const [, setLocation] = useLocation();
  const goBack = useGoBack();
  return (
    <LeaderboardScreen
      venueId={params.venueId}
      onBack={() => goBack("/leaderboard")}
      onManual={() => setLocation("/about")}
      onAccount={() => setLocation("/account")}
      onFindPlayers={() => setLocation("/find-players")}
      onStats={() => setLocation("/stats")}
      onSignIn={() => setLocation("/sign-in")}
    />
  );
}

function CityLeaderboardRoute({ params }: { params: { locality: string } }) {
  const [, setLocation] = useLocation();
  const goBack = useGoBack();
  return (
    <LeaderboardScreen
      cityLocality={decodeURIComponent(params.locality)}
      onBack={() => goBack("/leaderboard")}
      onManual={() => setLocation("/about")}
      onAccount={() => setLocation("/account")}
      onFindPlayers={() => setLocation("/find-players")}
      onStats={() => setLocation("/stats")}
      onSignIn={() => setLocation("/sign-in")}
    />
  );
}

function AboutRoute() {
  const [, setLocation] = useLocation();
  const goBack = useGoBack();
  return <AboutScreen onBack={() => goBack("/")} onPasses={() => setLocation("/passes")} />;
}

function LegalRoute() {
  const goBack = useGoBack();
  return <LegalScreen onBack={() => goBack("/")} />;
}

function FindPlayersRoute() {
  const [, setLocation] = useLocation();
  const goBack = useGoBack();
  return (
    <FindPlayersScreen
      onBack={() => goBack("/")}
      onManual={() => setLocation("/about")}
      onAccount={() => setLocation("/account")}
      onLeaderboard={() => setLocation("/leaderboard")}
      onSignIn={() => setLocation("/sign-in")}
      onPasses={() => setLocation("/passes")}
    />
  );
}

function PassesRoute() {
  const goBack = useGoBack();
  return <PassesScreen onBack={() => goBack("/account")} />;
}

function RedeemRoute({ params }: { params: { code: string } }) {
  const [, setLocation] = useLocation();
  return (
    <RedeemScreen
      code={params.code}
      onHome={() => setLocation("/")}
      onAccount={() => setLocation("/account")}
      onManual={() => setLocation("/about")}
      onSignUp={() => setLocation("/sign-up")}
    />
  );
}

function InviteRoute({ params }: { params: { code: string } }) {
  const [, setLocation] = useLocation();
  return (
    <InviteScreen
      code={params.code}
      onHome={() => setLocation("/")}
      onAccount={() => setLocation("/account")}
      onManual={() => setLocation("/about")}
      onSignUp={() => setLocation("/sign-up")}
    />
  );
}

function ClaimRoute() {
  const [, setLocation] = useLocation();
  return (
    <ClaimScreen
      onHome={() => setLocation("/")}
      onAccount={() => setLocation("/account")}
      onManual={() => setLocation("/about")}
      onSignUp={() => setLocation("/sign-up")}
    />
  );
}

function PoolStatsAppRoute() {
  const [, setLocation] = useLocation();
  return (
    <PoolStatsAppScreen
      onHome={() => setLocation("/")}
      onManual={() => setLocation("/about")}
      onAccount={() => setLocation("/account")}
      onStats={() => setLocation("/stats")}
      onFindPlayers={() => setLocation("/find-players")}
      onSignIn={() => setLocation("/sign-in")}
      onPasses={() => setLocation("/passes")}
    />
  );
}

function ForVenuesRoute() {
  const [, setLocation] = useLocation();
  return (
    <ForVenuesScreen
      onHome={() => setLocation("/")}
      onManual={() => setLocation("/about")}
      onAccount={() => setLocation("/account")}
      onStats={() => setLocation("/stats")}
      onFindPlayers={() => setLocation("/find-players")}
      onSignIn={() => setLocation("/sign-in")}
      onPasses={() => setLocation("/passes")}
    />
  );
}

function JoinRoute({ params }: { params: { code: string } }) {
  const [, setLocation] = useLocation();
  const goBack = useGoBack();
  return (
    <JoinedGameScreen
      code={params.code.toUpperCase()}
      onBack={() => goBack("/")}
      onManual={() => setLocation("/about")}
      onAccount={() => setLocation("/account")}
      onSignIn={() => setLocation("/sign-in")}
    />
  );
}

function WatchRoute({ params }: { params: { name: string } }) {
  const [, setLocation] = useLocation();
  const goBack = useGoBack();
  const search = useSearch();
  // Guard against malformed percent-encoding (e.g. a stray `%`), which would
  // otherwise throw a URIError and crash the route. Fall back to the raw value.
  let name = params.name;
  try { name = decodeURIComponent(params.name); } catch { /* keep raw */ }
  // OBS overlay flags. `?obs=1` strips all chrome and goes transparent so the
  // HUD can be dropped into OBS as a Browser Source; `?log=1` adds a compact
  // shot log; `?scale=<n>` CSS-scales the overlay for crisp resizing.
  const sp = new URLSearchParams(search);
  const obs = sp.get("obs") === "1";
  const obsLog = sp.get("log") === "1";
  const obsScale = clampObsScale(parseFloat(sp.get("scale") ?? "1"));
  const obsDemo = obs && sp.get("demo") === "1";
  return (
    <WatchByNameScreen
      name={name}
      onBack={() => goBack("/")}
      onManual={() => setLocation("/about")}
      onAccount={() => setLocation("/account")}
      onSignIn={() => setLocation("/sign-in")}
      obs={obs}
      obsLog={obsLog}
      obsScale={obsScale}
      demo={obsDemo}
    />
  );
}

// Route `component` props must be stable references, never inline factories
// (`component={() => ...}`). An inline factory changes identity on every parent
// re-render, remounting Clerk's <SignIn>/<SignUp> and re-sending verification codes.
function SignInRouteWrapper() {
  const goBack = useGoBack();
  return <SignInPage onBack={() => goBack("/")} />;
}

function SignUpRouteWrapper() {
  const goBack = useGoBack();
  return <SignUpPage onBack={() => goBack("/")} />;
}

function Routes() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={SignInRouteWrapper} />
      <Route path="/sign-up/*?" component={SignUpRouteWrapper} />
      <Route path="/account" component={AccountRoute} />
      <Route path="/stats" component={StatsRoute} />
      <Route path="/leaderboard/hall/:venueId" component={HallLeaderboardRoute} />
      <Route path="/leaderboard/city/:locality" component={CityLeaderboardRoute} />
      <Route path="/leaderboard" component={LeaderboardRoute} />
      <Route path="/find-players" component={FindPlayersRoute} />
      <Route path="/about" component={AboutRoute} />
      <Route path="/legal" component={LegalRoute} />
      <Route path="/passes" component={PassesRoute} />
      <Route path="/pool-stats-app" component={PoolStatsAppRoute} />
      <Route path="/for-venues" component={ForVenuesRoute} />
      <Route path="/redeem/:code" component={RedeemRoute} />
      <Route path="/invite/:code" component={InviteRoute} />
      <Route path="/claim" component={ClaimRoute} />
      <Route path="/join/:code" component={JoinRoute} />
      <Route path="/watch/:name" component={WatchRoute} />
      <Route component={MainApp} />
    </Switch>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <CacheInvalidator />
          <RedeemResumer />
          <Routes />
        </QueryClientProvider>
      </AuthProvider>
    </WouterRouter>
  );
}
