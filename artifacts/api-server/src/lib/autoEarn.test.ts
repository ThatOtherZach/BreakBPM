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

/** Shark (solo 8-ball) win — host beat the AI. */
function sharkWin(daysAgo = 1, hostName = "Alice"): ClassifiedGame {
  return game({ gameType: "8ball", maxPlayers: 1, daysAgo, winner: hostName, hostDisplayName: hostName });
}

/** Shark (solo 8-ball) loss — the 🦈 AI won. */
function sharkLoss(daysAgo = 1, hostName = "Alice"): ClassifiedGame {
  return game({ gameType: "8ball", maxPlayers: 1, daysAgo, winner: "🦈 Shark", hostDisplayName: hostName });
}

/** Standard 8-ball win for the host. */
function hustlerWin(daysAgo = 1, hostName = "Alice"): ClassifiedGame {
  return game({ daysAgo, winner: hostName, hostDisplayName: hostName });
}

/** Standard 8-ball loss for the host (opponent won). */
function hustlerLoss(daysAgo = 1, hostName = "Alice"): ClassifiedGame {
  return game({ daysAgo, winner: "Bob", hostDisplayName: hostName });
}

/** Practice game. */
function practiceGame(daysAgo = 1): ClassifiedGame {
  return game({ gameType: "practice", maxPlayers: 1, daysAgo });
}

/** 9-ball game (no theme). */
function nineBallGame(daysAgo = 1): ClassifiedGame {
  return game({ gameType: "9ball", daysAgo });
}

// ---------------------------------------------------------------------------
// Shark — 5 wins in Shark mode
// ---------------------------------------------------------------------------

describe("computeAutoEarnedVariantFromGames — shark (5-win threshold)", () => {
  it("returns null when there are no games", () => {
    expect(computeAutoEarnedVariantFromGames([])).toBeNull();
  });

  it("earns shark with exactly 5 wins, most recent within 10 days", () => {
    const games = Array.from({ length: 5 }, (_, i) => sharkWin(i + 1));
    expect(computeAutoEarnedVariantFromGames(games)).toBe("shark");
  });

  it("does NOT earn shark with only 4 wins", () => {
    const games = Array.from({ length: 4 }, (_, i) => sharkWin(i + 1));
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("does NOT earn shark when losses are mixed in and wins < 5", () => {
    const games = [
      ...Array.from({ length: 3 }, (_, i) => sharkWin(i + 1)),
      ...Array.from({ length: 5 }, (_, i) => sharkLoss(i + 4)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("earns shark when losses are mixed in but wins still reach 5", () => {
    const games = [
      ...Array.from({ length: 5 }, (_, i) => sharkWin(i + 1)),
      ...Array.from({ length: 10 }, (_, i) => sharkLoss(i + 6)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBe("shark");
  });

  it("does NOT earn shark when the most recent win is older than 10 days", () => {
    const games = Array.from({ length: 5 }, (_, i) => sharkWin(i + 11)); // newest=11d
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("earns shark when the most recent win is exactly 9 days ago", () => {
    const games = Array.from({ length: 5 }, (_, i) => sharkWin(i + 9)); // newest=9d
    expect(computeAutoEarnedVariantFromGames(games)).toBe("shark");
  });

  it("counts shark wins across up to 50 games (beyond the first 10)", () => {
    // 5 wins spread across games 11–15 — all older than 10 days → freshness fails
    const games = [
      ...Array.from({ length: 10 }, (_, i) => sharkLoss(i + 1)),
      ...Array.from({ length: 5 }, (_, i) => sharkWin(i + 11)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("counts shark wins across up to 50 games with a recent win in front", () => {
    // 1 recent win + 4 older wins = 5 total, most recent=1d
    const games = [
      sharkWin(1),
      ...Array.from({ length: 4 }, (_, i) => sharkWin(i + 30)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBe("shark");
  });

  it("does NOT earn shark when winner is null (AI not beaten / no winner set)", () => {
    const games = Array.from({ length: 5 }, (_, i) =>
      game({ gameType: "8ball", maxPlayers: 1, daysAgo: i + 1, winner: null, hostDisplayName: "Alice" }),
    );
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("does NOT earn shark when hostDisplayName is null (participant row missing)", () => {
    const games = Array.from({ length: 5 }, (_, i) =>
      game({ gameType: "8ball", maxPlayers: 1, daysAgo: i + 1, winner: "Alice", hostDisplayName: null }),
    );
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hustler — 10 wins in standard 8-ball
// ---------------------------------------------------------------------------

describe("computeAutoEarnedVariantFromGames — hustler (10-win threshold)", () => {
  it("earns hustler with exactly 10 wins, most recent within 10 days", () => {
    const games = Array.from({ length: 10 }, (_, i) => hustlerWin(i + 1));
    expect(computeAutoEarnedVariantFromGames(games)).toBe("hustler");
  });

  it("does NOT earn hustler with only 9 wins", () => {
    const games = Array.from({ length: 9 }, (_, i) => hustlerWin(i + 1));
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("does NOT earn hustler when losses are mixed in and wins < 10", () => {
    const games = [
      ...Array.from({ length: 5 }, (_, i) => hustlerWin(i + 1)),
      ...Array.from({ length: 5 }, (_, i) => hustlerLoss(i + 6)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("earns hustler when losses are mixed in but wins still reach 10", () => {
    const games = [
      ...Array.from({ length: 10 }, (_, i) => hustlerWin(i + 1)),
      ...Array.from({ length: 10 }, (_, i) => hustlerLoss(i + 11)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBe("hustler");
  });

  it("does NOT earn hustler when the most recent win is older than 10 days", () => {
    const games = Array.from({ length: 10 }, (_, i) => hustlerWin(i + 11));
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("earns hustler when the most recent win is exactly 9 days ago", () => {
    const games = Array.from({ length: 10 }, (_, i) => hustlerWin(i + 9));
    expect(computeAutoEarnedVariantFromGames(games)).toBe("hustler");
  });

  it("does NOT earn hustler from Chaos 8-ball wins — they earn pool-player via majority instead", () => {
    const games = Array.from({ length: 10 }, (_, i) =>
      game({ daysAgo: i + 1, chaosMode: "chaos", winner: "Alice", hostDisplayName: "Alice" }),
    );
    expect(computeAutoEarnedVariantFromGames(games)).toBe("pool-player");
  });

  it("does NOT earn hustler from Shark-mode wins (classified as shark)", () => {
    const games = Array.from({ length: 10 }, (_, i) => sharkWin(i + 1));
    // 10 shark wins → earns shark (5-win threshold met), not hustler
    expect(computeAutoEarnedVariantFromGames(games)).toBe("shark");
  });

  it("does NOT earn hustler when winner is null", () => {
    const games = Array.from({ length: 10 }, (_, i) =>
      game({ daysAgo: i + 1, winner: null, hostDisplayName: "Alice" }),
    );
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("does NOT earn hustler when hostDisplayName is null", () => {
    const games = Array.from({ length: 10 }, (_, i) =>
      game({ daysAgo: i + 1, winner: "Alice", hostDisplayName: null }),
    );
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("counts 9-ball wins toward the hustler threshold", () => {
    // 5 standard 8-ball wins + 5 9-ball wins = 10 total → hustler
    const games = [
      ...Array.from({ length: 5 }, (_, i) => hustlerWin(i + 1)),
      ...Array.from({ length: 5 }, (_, i) =>
        game({ gameType: "9ball", daysAgo: i + 6, winner: "Alice", hostDisplayName: "Alice" }),
      ),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBe("hustler");
  });

  it("earns hustler from 10 pure 9-ball wins", () => {
    const games = Array.from({ length: 10 }, (_, i) =>
      game({ gameType: "9ball", daysAgo: i + 1, winner: "Alice", hostDisplayName: "Alice" }),
    );
    expect(computeAutoEarnedVariantFromGames(games)).toBe("hustler");
  });

  it("does NOT earn hustler from 9-ball losses", () => {
    const games = Array.from({ length: 10 }, (_, i) =>
      game({ gameType: "9ball", daysAgo: i + 1, winner: "Bob", hostDisplayName: "Alice" }),
    );
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pool-player — majority of first 10 games
// ---------------------------------------------------------------------------

describe("computeAutoEarnedVariantFromGames — pool-player (majority of first 10)", () => {
  it("earns pool-player when >50% of first 10 are practice, within 10 days", () => {
    const games = [
      ...Array.from({ length: 7 }, (_, i) => practiceGame(i + 1)),
      ...Array.from({ length: 3 }, (_, i) => nineBallGame(i + 8)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBe("pool-player");
  });

  it("does NOT earn pool-player when most recent practice game is >10 days old", () => {
    const games = [
      ...Array.from({ length: 4 }, (_, i) => nineBallGame(i + 1)),
      ...Array.from({ length: 6 }, (_, i) => practiceGame(i + 11)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });

  it("does NOT earn pool-player on an exact 50/50 split (no majority)", () => {
    const games = [
      ...Array.from({ length: 5 }, (_, i) => practiceGame(i + 1)),
      ...Array.from({ length: 5 }, (_, i) => nineBallGame(i + 6)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Priority ordering
// ---------------------------------------------------------------------------

describe("computeAutoEarnedVariantFromGames — priority ordering", () => {
  it("pool-player majority beats shark win-count when both are met", () => {
    // 6/10 practice = pool-player majority; also 5 shark wins beyond that
    const games = [
      ...Array.from({ length: 6 }, (_, i) => practiceGame(i + 1)),
      ...Array.from({ length: 4 }, (_, i) => nineBallGame(i + 7)),
      ...Array.from({ length: 5 }, (_, i) => sharkWin(i + 11)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBe("pool-player");
  });

  it("pool-player majority beats hustler win-count when both are met", () => {
    const games = [
      ...Array.from({ length: 6 }, (_, i) => practiceGame(i + 1)),
      ...Array.from({ length: 4 }, (_, i) => nineBallGame(i + 7)),
      ...Array.from({ length: 10 }, (_, i) => hustlerWin(i + 11)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBe("pool-player");
  });

  it("shark win-count beats hustler win-count when both are met", () => {
    // 5 shark wins + 10 hustler wins, no pool-player majority
    const games = [
      ...Array.from({ length: 5 }, (_, i) => sharkWin(i + 1)),
      ...Array.from({ length: 5 }, (_, i) => nineBallGame(i + 6)),
      ...Array.from({ length: 10 }, (_, i) => hustlerWin(i + 11)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBe("shark");
  });

  it("hustler applies as final fallback when no pool-player majority and no shark wins", () => {
    const games = [
      ...Array.from({ length: 5 }, (_, i) => nineBallGame(i + 1)),
      ...Array.from({ length: 5 }, (_, i) => hustlerWin(i + 1)),
      ...Array.from({ length: 5 }, (_, i) => hustlerWin(i + 11)),
    ];
    expect(computeAutoEarnedVariantFromGames(games)).toBe("hustler");
  });
});
