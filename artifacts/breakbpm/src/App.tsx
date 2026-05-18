import { useState, useEffect, useRef } from "react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";

import SetupScreen from "./components/SetupScreen";
import GameScreen from "./components/GameScreen";
import AboutScreen from "./components/AboutScreen";
import AccountScreen from "./components/AccountScreen";
import PassesScreen from "./components/PassesScreen";
import { SignInPage, SignUpPage } from "./components/SignInPage";
import type { GameType, GameState, Player } from "./lib/gameLogic";
import {
  generateShareCode,
  decodeGameState,
  loadInProgressGame,
  clearInProgressGame,
} from "./lib/gameLogic";
import { queryClient } from "./lib/queryClient";
import { AuthProvider, useAuth } from "./lib/authClient";

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

function createInitialGameState(gameType: GameType, players: Player[]): GameState {
  return {
    phase: "playing",
    gameType,
    players,
    currentPlayerIndex: 0,
    sunkBalls: [],
    shotLog: [],
    gameStartTime: Date.now(),
    firstActionTime: null,
    lastActionTime: null,
    winner: null,
    winMessage: "",
    shareCode: generateShareCode(),
    teamAssigned: players.some((p) => p.team !== undefined),
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
  const [view, setView] = useState<AppView>("setup");
  const [gameState, setGameState] = useState<GameState | null>(null);
  // Server-issued in-progress game id (signed-in users only). Held outside
  // the URL-shared GameState so it isn't leaked via share links.
  const [serverGameId, setServerGameId] = useState<string | null>(null);
  // Hard wall-clock cap for anonymous play (server returns 1 hr); null
  // for signed-in users.
  const [maxGameDurationMs, setMaxGameDurationMs] = useState<number | null>(null);

  useEffect(() => {
    // Primary recovery path: localStorage holds the full in-progress game
    // (including shotLog and the server-issued gameId) so a refresh, tab
    // close, or connection drop can resume the exact same game.
    const persisted = loadInProgressGame();
    if (persisted) {
      setGameState(persisted.state);
      setServerGameId(persisted.serverGameId);
      setMaxGameDurationMs(persisted.maxGameDurationMs);
      setView("game");
      return;
    }
    // Fallback: legacy URL-encoded share links. Lossy for shotLog/serverGameId
    // but kept so old `?state=` links still open something playable.
    const restored = loadStateFromUrl();
    if (restored && restored.phase && restored.players && restored.players.length > 0) {
      setGameState({
        phase: restored.phase!,
        gameType: restored.gameType ?? "8ball",
        players: restored.players ?? [],
        currentPlayerIndex: restored.currentPlayerIndex ?? 0,
        sunkBalls: restored.sunkBalls ?? [],
        shotLog: restored.shotLog ?? [],
        gameStartTime: restored.gameStartTime ?? Date.now(),
        firstActionTime: restored.firstActionTime ?? null,
        lastActionTime: restored.lastActionTime ?? null,
        winner: restored.winner ?? null,
        winMessage: restored.winMessage ?? "",
        shareCode: restored.shareCode ?? generateShareCode(),
        teamAssigned: restored.teamAssigned ?? false,
      });
      setView("game");
    }
  }, []);

  function handleStart(gameType: GameType, players: Player[], gameId: string | null, maxMs: number | null) {
    // Explicit fresh start — wipe any stale in-progress checkpoint so we
    // don't immediately resurrect the previous game on the next mount.
    clearInProgressGame();
    setGameState(createInitialGameState(gameType, players));
    setServerGameId(gameId);
    setMaxGameDurationMs(maxMs);
    setView("game");
    const url = new URL(window.location.href);
    url.searchParams.delete("state");
    url.searchParams.delete("game");
    window.history.replaceState(null, "", url.toString());
  }
  function handleNewGame() {
    clearInProgressGame();
    setGameState(null);
    setServerGameId(null);
    setMaxGameDurationMs(null);
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

function Routes() {
  const [, setLocation] = useLocation();
  return (
    <Switch>
      <Route path="/sign-in/*?" component={() => <SignInPage onBack={() => setLocation("/")} />} />
      <Route path="/sign-up/*?" component={() => <SignUpPage onBack={() => setLocation("/")} />} />
      <Route path="/account" component={AccountRoute} />
      <Route path="/about" component={AboutRoute} />
      <Route path="/passes" component={PassesRoute} />
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
