import { useState, useEffect, useRef } from "react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";

import SetupScreen from "./components/SetupScreen";
import GameScreen from "./components/GameScreen";
import JoinedGameScreen from "./components/JoinedGameScreen";
import WatchByNameScreen from "./components/WatchByNameScreen";
import AboutScreen from "./components/AboutScreen";
import AccountScreen from "./components/AccountScreen";
import StatsScreen from "./components/StatsScreen";
import FindPlayersScreen from "./components/FindPlayersScreen";
import PassesScreen from "./components/PassesScreen";
import { SignInPage, SignUpPage } from "./components/SignInPage";
import type { GameType, GameState, Player, SharkAggression } from "./lib/gameLogic";
import {
  generateShareCode,
  decodeGameState,
  loadInProgressGame,
  clearInProgressGame,
  normalizeSharkIdentity,
} from "./lib/gameLogic";
import { queryClient } from "./lib/queryClient";
import { AuthProvider, useAuth } from "./lib/authClient";
import { useAbandonGame } from "@workspace/api-client-react";

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
): GameState {
  // Shark mode is solo 8-ball with an opponent steal mechanic. Only seed
  // the shark fields when the combo actually matches — keeps state shape
  // clean for the 99% of games that aren't shark.
  const isShark = gameType === "8ball" && players.length === 1 && sharkAggression !== undefined;
  return {
    phase: "playing",
    gameType,
    players,
    currentPlayerIndex: 0,
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

function MainApp() {
  const [, setLocation] = useLocation();
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
  ) {
    // Explicit fresh start — wipe any stale in-progress checkpoint so we
    // don't immediately resurrect the previous game on the next mount.
    clearInProgressGame();
    setGameState(createInitialGameState(gameType, players, serverShareCode, sharkAggression));
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

  const goSignIn = () => setLocation("/sign-in");
  const goAbout = () => setLocation("/about");
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
        onAbout={goAbout}
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
      onAbout={goAbout}
      onAccount={goAccount}
      onStats={goStats}
      onFindPlayers={goFindPlayers}
      onSignIn={goSignIn}
    />
  );
}

function AccountRoute() {
  const [, setLocation] = useLocation();
  return (
    <AccountScreen
      onBack={() => setLocation("/")}
      onPasses={() => setLocation("/passes")}
      onAbout={() => setLocation("/about")}
      onFindPlayers={() => setLocation("/find-players")}
      onSignIn={() => setLocation("/sign-in")}
    />
  );
}

function StatsRoute() {
  const [, setLocation] = useLocation();
  return (
    <StatsScreen
      onBack={() => setLocation("/")}
      onAbout={() => setLocation("/about")}
      onAccount={() => setLocation("/account")}
      onFindPlayers={() => setLocation("/find-players")}
      onSignIn={() => setLocation("/sign-in")}
      onPasses={() => setLocation("/passes")}
    />
  );
}

function AboutRoute() {
  const [, setLocation] = useLocation();
  return <AboutScreen onBack={() => setLocation("/")} />;
}

function FindPlayersRoute() {
  const [, setLocation] = useLocation();
  return (
    <FindPlayersScreen
      onBack={() => setLocation("/")}
      onAbout={() => setLocation("/about")}
      onAccount={() => setLocation("/account")}
      onSignIn={() => setLocation("/sign-in")}
    />
  );
}

function PassesRoute() {
  const [, setLocation] = useLocation();
  return <PassesScreen onBack={() => setLocation("/account")} />;
}

function JoinRoute({ params }: { params: { code: string } }) {
  const [, setLocation] = useLocation();
  return (
    <JoinedGameScreen
      code={params.code.toUpperCase()}
      onBack={() => setLocation("/")}
      onAbout={() => setLocation("/about")}
      onAccount={() => setLocation("/account")}
      onSignIn={() => setLocation("/sign-in")}
    />
  );
}

function WatchRoute({ params }: { params: { name: string } }) {
  const [, setLocation] = useLocation();
  // Guard against malformed percent-encoding (e.g. a stray `%`), which would
  // otherwise throw a URIError and crash the route. Fall back to the raw value.
  let name = params.name;
  try { name = decodeURIComponent(params.name); } catch { /* keep raw */ }
  return (
    <WatchByNameScreen
      name={name}
      onBack={() => setLocation("/")}
      onAbout={() => setLocation("/about")}
      onAccount={() => setLocation("/account")}
      onSignIn={() => setLocation("/sign-in")}
    />
  );
}

// Route `component` props must be stable references, never inline factories
// (`component={() => ...}`). An inline factory changes identity on every parent
// re-render, remounting Clerk's <SignIn>/<SignUp> and re-sending verification codes.
function SignInRouteWrapper() {
  const [, setLocation] = useLocation();
  return <SignInPage onBack={() => setLocation("/")} />;
}

function SignUpRouteWrapper() {
  const [, setLocation] = useLocation();
  return <SignUpPage onBack={() => setLocation("/")} />;
}

function Routes() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={SignInRouteWrapper} />
      <Route path="/sign-up/*?" component={SignUpRouteWrapper} />
      <Route path="/account" component={AccountRoute} />
      <Route path="/stats" component={StatsRoute} />
      <Route path="/find-players" component={FindPlayersRoute} />
      <Route path="/about" component={AboutRoute} />
      <Route path="/passes" component={PassesRoute} />
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
          <Routes />
        </QueryClientProvider>
      </AuthProvider>
    </WouterRouter>
  );
}
