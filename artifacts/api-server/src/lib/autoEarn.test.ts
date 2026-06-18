import { describe, it, expect } from "vitest";
import {
  computeAutoEarnedVariantFromGames,
  type ClassifiedGame,
} from "./userProfileBackground";

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

/** Build a ClassifiedGame for the last-N-days window. */
function game(
  opts: Partial<ClassifiedGame> & { daysAgo?: number } = {},
): ClassifiedGame {
  const { daysAgo = 1, ...rest } = opts;
  return {
    gameType: "8ball",
    maxPlayers: 2,
    chaosMode: null,
    endedAt: new Date(NOW - daysAgo * DAY),
    winner: null,
    hostDisplayName: null,
    ...rest,
  };
}

/** Standard 8-ball win for the host. */
function hustlerWin(daysAgo = 1, hostName = "Alice"): ClassifiedGame {
  return game({ daysAgo, winner: hostName, hostDisplayName: hostName });
}

/** Standard 8-ball loss for the host (opponent won). */
function hustlerLoss(daysAgo = 1, hostName = "Alice"): ClassifiedGame {
  return game({ daysAgo, winner: "Bob", hostDisplayName: hostName });
}

/** Shark (solo 8-ball) game — always a "completed" game from the host. */
function sharkGame(daysAgo = 1): ClassifiedGame {
  return game({ gameType: "8ball", maxPlayers: 1, daysAgo, winner: "Alice", hostDisplayName: "Alice" });
}

/** Practice game. */
function practiceGame(daysAgo = 1): ClassifiedGame {
  return game({ gameType: "practice", maxPlayers: 1, daysAgo });
}

/** 9-ball game (no theme). */
function nineBallGame(daysAgo = 1): ClassifiedGame {
  return game({ gameType: "9ball", daysAgo });
}

describe("computeAutoEarnedVariantFromGames — hustler (standard 8-ball)", () => {
  it("returns null when there are no games", () => {
    expect(computeAutoEarnedVariantFromGames([])).toBeNull();
  });

  it("earns hustler with exactly 10 wins, most recent within 10 days", () => {
    const games = Array.from({ length: 10 }, (_, i) => hustlerWin(i + 1));
    expect(computeAutoEarnedVariantFromGames(games)).toBe("hustler");
  });

  it("does NOT earn hustler with only 9 wins", () => {
    const games = Array.from({ length: 9 }, (_, i) => hustlerWin(i + 1));
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("does NOT earn hustler when losses are mixed in and wins < 10", () => {
    // 5 wins + 5 losses = 5 wins total
    const games = [
      ...Array.from({ length: 5 }, (_, i) => hustlerWin(i + 1)),
      ...Array.from({ length: 5 }, (_, i) => hustlerLoss(i + 6)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("earns hustler when losses are mixed in but wins still reach 10", () => {
    // 10 wins + 10 losses = 10 wins — should pass
    const games = [
      ...Array.from({ length: 10 }, (_, i) => hustlerWin(i + 1)),
      ...Array.from({ length: 10 }, (_, i) => hustlerLoss(i + 11)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBe("hustler");
  });

  it("does NOT earn hustler when the most recent win is older than 10 days", () => {
    const games = Array.from({ length: 10 }, (_, i) => hustlerWin(i + 11)); // oldest=20d, newest=11d
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("earns hustler when the most recent win is exactly 9 days ago", () => {
    const games = Array.from({ length: 10 }, (_, i) => hustlerWin(i + 9)); // newest=9d ago
    expect(computeAutoEarnedVariantFromGames(games)).toBe("hustler");
  });

  it("counts wins across up to 50 games (beyond the first 10)", () => {
    // 10 wins spread across slots 11–20 (only reachable past the first-10 window)
    const games = [
      ...Array.from({ length: 10 }, (_, i) => hustlerLoss(i + 1)), // first 10: losses
      ...Array.from({ length: 10 }, (_, i) => hustlerWin(i + 11)), // wins at 11–20d
    ];
    // Most recent win is 11 days ago → freshness gate should fail
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("counts wins across up to 50 games with a recent win in the first batch", () => {
    // 1 win recently + 9 wins further back = 10 total wins, most recent=1d
    const games = [
      hustlerWin(1), // most recent — within 10d
      ...Array.from({ length: 9 }, (_, i) => hustlerWin(i + 30)), // older wins
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBe("hustler");
  });

  it("does NOT earn hustler from games where winner is null (unfinished / no winner)", () => {
    const games = Array.from({ length: 10 }, (_, i) =>
      game({ daysAgo: i + 1, winner: null, hostDisplayName: "Alice" }),
    );
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("does NOT earn hustler when hostDisplayName is null (participant row missing)", () => {
    const games = Array.from({ length: 10 }, (_, i) =>
      game({ daysAgo: i + 1, winner: "Alice", hostDisplayName: null }),
    );
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("does NOT earn hustler from Chaos 8-ball wins — they earn pool-player via majority instead", () => {
    const games = Array.from({ length: 10 }, (_, i) =>
      game({ daysAgo: i + 1, chaosMode: "chaos", winner: "Alice", hostDisplayName: "Alice" }),
    );
    // Chaos games classify as pool-player, so 10/10 = majority → pool-player, not hustler
    expect(computeAutoEarnedVariantFromGames(games)).toBe("pool-player");
  });

  it("does NOT earn hustler from solo 8-ball (Shark) wins", () => {
    const games = Array.from({ length: 10 }, (_, i) => sharkGame(i + 1));
    // 10 shark games → majority of 10 → shark, not hustler
    expect(computeAutoEarnedVariantFromGames(games)).toBe("shark");
  });
});

describe("computeAutoEarnedVariantFromGames — shark / pool-player (majority of first 10)", () => {
  it("earns shark when >50% of first 10 games are solo 8-ball, within 10 days", () => {
    const games = [
      ...Array.from({ length: 6 }, (_, i) => sharkGame(i + 1)),
      ...Array.from({ length: 4 }, (_, i) => nineBallGame(i + 7)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBe("shark");
  });

  it("does NOT earn shark when most recent shark game is >10 days old", () => {
    const games = [
      ...Array.from({ length: 4 }, (_, i) => nineBallGame(i + 1)), // recent but 9-ball
      ...Array.from({ length: 6 }, (_, i) => sharkGame(i + 11)),   // shark but stale
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("earns pool-player when >50% of first 10 are practice, within 10 days", () => {
    const games = [
      ...Array.from({ length: 7 }, (_, i) => practiceGame(i + 1)),
      ...Array.from({ length: 3 }, (_, i) => nineBallGame(i + 8)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBe("pool-player");
  });

  it("returns null on a tie between shark and pool-player", () => {
    const games = [
      ...Array.from({ length: 5 }, (_, i) => sharkGame(i + 1)),
      ...Array.from({ length: 5 }, (_, i) => practiceGame(i + 6)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("shark majority (first 10) wins over hustler win-count when both criteria would be met", () => {
    // 6 shark in first 10 + 10 hustler wins beyond → shark takes priority
    const games = [
      ...Array.from({ length: 6 }, (_, i) => sharkGame(i + 1)),
      ...Array.from({ length: 4 }, (_, i) => nineBallGame(i + 7)),
      ...Array.from({ length: 10 }, (_, i) => hustlerWin(i + 11)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBe("shark");
  });

  it("hustler win-count applies as fallback when no shark/pool-player majority", () => {
    // No majority in first 10, but 10 hustler wins across 50 games
    const games = [
      ...Array.from({ length: 5 }, (_, i) => sharkGame(i + 1)),  // 5 shark — not majority
      ...Array.from({ length: 5 }, (_, i) => hustlerWin(i + 1)), // 5 hustler wins in first 10
      ...Array.from({ length: 5 }, (_, i) => hustlerWin(i + 11)), // 5 more hustler wins
    ];
    // 5 shark, 10 hustler wins total, most recent win = 1d ago
    expect(computeAutoEarnedVariantFromGames(games)).toBe("hustler");
  });
});
