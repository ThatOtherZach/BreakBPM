import { useState, useEffect, useRef } from "react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";

import SetupScreen from "./components/SetupScreen";
import GameScreen from "./components/GameScreen";
import JoinedGameScreen from "./components/JoinedGameScreen";
import AboutScreen from "./components/AboutScreen";
import AccountScreen from "./components/AccountScreen";
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
  // Legacy share links used `?game=<code>` to join. Redirect them to
  // the canonical `/join/:code` route so recipients always land in the
  // read-only joiner view.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const legacy = params.get("game");
      if (legacy) {
        const code = legacy.trim().toUpperCase();
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
      onSignIn={() => setLocation("/sign-in")}
    />
  );
}

function AboutRoute() {
  const [, setLocation] = useLocation();
  return <AboutScreen onBack={() => setLocation("/")} />;
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

function Routes() {
  const [, setLocation] = useLocation();
  return (
    <Switch>
      <Route path="/sign-in/*?" component={() => <SignInPage onBack={() => setLocation("/")} />} />
      <Route path="/sign-up/*?" component={() => <SignUpPage onBack={() => setLocation("/")} />} />
      <Route path="/account" component={AccountRoute} />
      <Route path="/about" component={AboutRoute} />
      <Route path="/passes" component={PassesRoute} />
      <Route path="/join/:code" component={JoinRoute} />
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
