import { useState, useEffect } from 'react';
import SetupScreen from './components/SetupScreen';
import GameScreen from './components/GameScreen';
import AboutScreen from './components/AboutScreen';
import type { GameType, GameState, Player } from './lib/gameLogic';
import { generateShareCode, decodeGameState } from './lib/gameLogic';

type View = 'setup' | 'game' | 'about';

function loadStateFromUrl(): Partial<GameState> | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('state');
    if (encoded) {
      return decodeGameState(encoded);
    }
  } catch {}
  return null;
}

function createInitialGameState(gameType: GameType, players: Player[]): GameState {
  return {
    phase: 'playing',
    gameType,
    players,
    currentPlayerIndex: 0,
    sunkBalls: [],
    shotLog: [],
    gameStartTime: Date.now(),
    firstActionTime: null,
    lastActionTime: null,
    winner: null,
    winMessage: '',
    shareCode: generateShareCode(),
    teamAssigned: players.some(p => p.team !== undefined),
  };
}

export default function App() {
  const [view, setView] = useState<View>('setup');
  const [gameState, setGameState] = useState<GameState | null>(null);

  useEffect(() => {
    const restored = loadStateFromUrl();
    if (restored && restored.phase && restored.players && restored.players.length > 0) {
      setGameState({
        phase: restored.phase!,
        gameType: restored.gameType ?? '8ball',
        players: restored.players ?? [],
        currentPlayerIndex: restored.currentPlayerIndex ?? 0,
        sunkBalls: restored.sunkBalls ?? [],
        shotLog: restored.shotLog ?? [],
        gameStartTime: restored.gameStartTime ?? Date.now(),
        firstActionTime: restored.firstActionTime ?? null,
        lastActionTime: restored.lastActionTime ?? null,
        winner: restored.winner ?? null,
        winMessage: restored.winMessage ?? '',
        shareCode: restored.shareCode ?? generateShareCode(),
        teamAssigned: restored.teamAssigned ?? false,
      });
      setView('game');
    }
  }, []);

  function handleStart(gameType: GameType, players: Player[]) {
    const newState = createInitialGameState(gameType, players);
    setGameState(newState);
    setView('game');
    const url = new URL(window.location.href);
    url.searchParams.delete('state');
    url.searchParams.delete('game');
    window.history.replaceState(null, '', url.toString());
  }

  function handleNewGame() {
    setGameState(null);
    setView('setup');
    const url = new URL(window.location.href);
    url.searchParams.delete('state');
    url.searchParams.delete('game');
    window.history.replaceState(null, '', url.toString());
  }

  function handleAbout() {
    setView('about');
  }

  function handleBackFromAbout() {
    setView(gameState ? 'game' : 'setup');
  }

  if (view === 'about') {
    return <AboutScreen onBack={handleBackFromAbout} />;
  }

  if (view === 'game' && gameState) {
    return (
      <GameScreen
        key={gameState.shareCode}
        initialState={gameState}
        onNewGame={handleNewGame}
        onAbout={handleAbout}
      />
    );
  }

  return <SetupScreen onStart={handleStart} onAbout={handleAbout} />;
}
