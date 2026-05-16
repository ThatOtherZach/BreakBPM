import { useState, useEffect, useRef } from "react";
import {
  ClerkProvider,
  useClerk,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";

import SetupScreen from "./components/SetupScreen";
import GameScreen from "./components/GameScreen";
import AboutScreen from "./components/AboutScreen";
import AccountScreen from "./components/AccountScreen";
import PassesScreen from "./components/PassesScreen";
import { SignInPage, SignUpPage } from "./components/SignInPage";
import type { GameType, GameState, Player } from "./lib/gameLogic";
import { generateShareCode, decodeGameState } from "./lib/gameLogic";
import { queryClient } from "./lib/queryClient";

// REQUIRED — copy verbatim. Resolves the key from window.location.hostname so the
// same build serves multiple Clerk custom domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
// REQUIRED — empty in dev, auto-set in prod. Do NOT gate on PROD/NODE_ENV.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

// Win98-themed Clerk appearance — keeps the modal visually consistent.
const clerkAppearance = {
  variables: {
    colorPrimary: "#000080",
    colorBackground: "#c0c0c0",
    colorInput: "#ffffff",
    colorInputForeground: "#000",
    colorForeground: "#000",
    colorMutedForeground: "#444",
    colorNeutral: "#808080",
    colorDanger: "#c00",
    fontFamily: "MS Sans Serif, Tahoma, Geneva, Arial, sans-serif",
    borderRadius: "0",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#c0c0c0]",
  },
};

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

// Invalidate query cache when signed-in user changes.
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsub = addListener(({ user }) => {
      const id = user?.id ?? null;
      if (prev.current !== undefined && prev.current !== id) qc.clear();
      prev.current = id;
    });
    return unsub;
  }, [addListener, qc]);
  return null;
}

function MainApp() {
  const [, setLocation] = useLocation();
  const [view, setView] = useState<AppView>("setup");
  const [gameState, setGameState] = useState<GameState | null>(null);

  useEffect(() => {
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

  function handleStart(gameType: GameType, players: Player[]) {
    setGameState(createInitialGameState(gameType, players));
    setView("game");
    const url = new URL(window.location.href);
    url.searchParams.delete("state");
    url.searchParams.delete("game");
    window.history.replaceState(null, "", url.toString());
  }
  function handleNewGame() {
    setGameState(null);
    setView("setup");
    const url = new URL(window.location.href);
    url.searchParams.delete("state");
    url.searchParams.delete("game");
    window.history.replaceState(null, "", url.toString());
  }

  const goSignIn = () => setLocation("/sign-in");

  if (view === "about") return <AboutScreen onBack={() => setView(gameState ? "game" : "setup")} />;
  if (view === "account") {
    return (
      <AccountScreen
        onBack={() => setView(gameState ? "game" : "setup")}
        onPasses={() => setView("passes")}
      />
    );
  }
  if (view === "passes") return <PassesScreen onBack={() => setView("account")} />;
  if (view === "game" && gameState) {
    return (
      <GameScreen
        key={gameState.shareCode}
        initialState={gameState}
        onNewGame={handleNewGame}
        onAbout={() => setView("about")}
        onAccount={() => setView("account")}
        onSignIn={goSignIn}
      />
    );
  }
  return (
    <SetupScreen
      onStart={handleStart}
      onAbout={() => setView("about")}
      onAccount={() => setView("account")}
      onSignIn={goSignIn}
    />
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/sign-in/*?" component={() => <SignInPage onBack={() => setLocation("/")} />} />
          <Route path="/sign-up/*?" component={() => <SignUpPage onBack={() => setLocation("/")} />} />
          <Route component={MainApp} />
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}
