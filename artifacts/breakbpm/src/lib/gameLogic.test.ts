import { describe, it, expect } from "vitest";
import {
  calculatePlayerBPM,
  calculatePlayerAccuracy,
  playerAccuracyCounts,
  checkSinkResult,
  assignTeams,
  getLegalBalls,
  getLowestBall,
  getSharkPickCandidates,
  resolveSharkPick,
  applySharkMiss,
  SHARK_PLAYER_NAME,
  SOLIDS,
  STRIPES,
  EIGHT_BALL,
  ALL_8BALL,
  type GameState,
  type Player,
  type ShotLogEntry,
  type ShotType,
} from "./gameLogic";

const MINUTE = 60_000;

/**
 * Builds a shot-log entry with sensible defaults. `timestamp` and `gameTime`
 * default to 0 so accuracy tests (which ignore timing) stay terse; BPM tests
 * pass explicit timestamps.
 */
function entry(
  type: ShotType,
  playerName: string,
  overrides: Partial<ShotLogEntry> = {},
): ShotLogEntry {
  return {
    type,
    playerName,
    timestamp: 0,
    gameTime: 0,
    ...overrides,
  };
}

describe("playerAccuracyCounts / calculatePlayerAccuracy", () => {
  it("counts a normal sink/miss/foul mix", () => {
    const log: ShotLogEntry[] = [
      entry("sink", "Alice", { ball: 1 }),
      entry("sink", "Alice", { ball: 2 }),
      entry("miss", "Alice"),
      entry("foul", "Alice"),
    ];
    expect(playerAccuracyCounts(log, "Alice")).toEqual({ made: 2, attempts: 4 });
    expect(calculatePlayerAccuracy(log, "Alice")).toBe(50);
  });

  it("excludes safeties from both made and attempts", () => {
    const log: ShotLogEntry[] = [
      entry("sink", "Alice", { ball: 1 }),
      entry("safety", "Alice"),
      entry("miss", "Alice"),
    ];
    // safety is not made and not an attempt: 1 made / 2 attempts
    expect(playerAccuracyCounts(log, "Alice")).toEqual({ made: 1, attempts: 2 });
    expect(calculatePlayerAccuracy(log, "Alice")).toBe(50);
  });

  it("never exceeds 100% — made is bounded by attempts (every made ball is an attempt)", () => {
    const log: ShotLogEntry[] = [
      entry("sink", "Alice", { ball: 1 }),
      entry("sink", "Alice", { ball: 2 }),
      entry("win", "Alice", { ball: 8 }),
    ];
    const { made, attempts } = playerAccuracyCounts(log, "Alice");
    expect(made).toBe(3);
    expect(attempts).toBe(3);
    expect(made).toBeLessThanOrEqual(attempts);
    expect(calculatePlayerAccuracy(log, "Alice")).toBe(100);
  });

  it("excludes Shark steals by player name", () => {
    const log: ShotLogEntry[] = [
      entry("sink", "Alice", { ball: 1 }),
      entry("miss", "Alice"),
      // Shark steals — logged under the Shark's name, must not touch Alice.
      entry("sink", SHARK_PLAYER_NAME, { ball: 9 }),
      entry("sink", SHARK_PLAYER_NAME, { ball: 10 }),
    ];
    expect(playerAccuracyCounts(log, "Alice")).toEqual({ made: 1, attempts: 2 });
    expect(calculatePlayerAccuracy(log, "Alice")).toBe(50);
    // The Shark's own counts are separate and never bleed into a human's.
    expect(playerAccuracyCounts(log, SHARK_PLAYER_NAME)).toEqual({
      made: 2,
      attempts: 2,
    });
  });

  it("counts a foul-on-8 'lose' (isFoul) as an attempt", () => {
    const log: ShotLogEntry[] = [
      entry("sink", "Alice", { ball: 1 }),
      // Foul on the 8-ball: terminal, logged as 'lose', no ball pocketed,
      // but flagged isFoul so it still counts as a shot attempt.
      entry("lose", "Alice", { isFoul: true }),
    ];
    expect(playerAccuracyCounts(log, "Alice")).toEqual({ made: 1, attempts: 2 });
    expect(calculatePlayerAccuracy(log, "Alice")).toBe(50);
  });

  it("does NOT count the Shark-wins 'lose' marker (no ball, not isFoul)", () => {
    const log: ShotLogEntry[] = [
      entry("sink", "Alice", { ball: 1 }),
      entry("miss", "Alice"),
      // Shark-wins marker: a 'lose' under the human's name with no ball and
      // no isFoul flag — not a shot Alice took, so excluded from attempts.
      entry("lose", "Alice", { note: "Shark wins — missed the 8-ball" }),
    ];
    expect(playerAccuracyCounts(log, "Alice")).toEqual({ made: 1, attempts: 2 });
    expect(calculatePlayerAccuracy(log, "Alice")).toBe(50);
  });

  it("returns null accuracy when the player has no qualifying shots", () => {
    const log: ShotLogEntry[] = [
      entry("safety", "Alice"),
      entry("lose", "Alice", { note: "Shark wins" }),
    ];
    expect(playerAccuracyCounts(log, "Alice")).toEqual({ made: 0, attempts: 0 });
    expect(calculatePlayerAccuracy(log, "Alice")).toBeNull();
  });
});

describe("calculatePlayerBPM", () => {
  it("returns null when the player has no pockets yet", () => {
    const log: ShotLogEntry[] = [
      entry("miss", "Alice", { timestamp: 0 }),
      entry("foul", "Alice", { timestamp: 1000 }),
      entry("safety", "Alice", { timestamp: 2000 }),
    ];
    expect(calculatePlayerBPM(log, "Alice")).toBeNull();
  });

  it("returns null when the player has no entries at all", () => {
    expect(calculatePlayerBPM([], "Alice")).toBeNull();
    const log: ShotLogEntry[] = [entry("sink", "Bob", { ball: 1, timestamp: 0 })];
    expect(calculatePlayerBPM(log, "Alice")).toBeNull();
  });

  it("returns 0 on sub-millisecond elapsed (single instantaneous pocket)", () => {
    // Only one entry: firstSinkAt === lastAt, elapsed is 0 → 0 guard.
    const log: ShotLogEntry[] = [
      entry("sink", "Alice", { ball: 1, timestamp: 5000 }),
    ];
    expect(calculatePlayerBPM(log, "Alice")).toBe(0);
  });

  it("computes a normal per-player pace", () => {
    // 2 balls pocketed, 1 minute between first sink and last entry → 2 BPM.
    const log: ShotLogEntry[] = [
      entry("sink", "Alice", { ball: 1, timestamp: 0 }),
      entry("sink", "Alice", { ball: 2, timestamp: MINUTE }),
    ];
    expect(calculatePlayerBPM(log, "Alice")).toBe(2);
  });
});

/** Two-player 8-ball roster: solids vs stripes once teams are assigned. */
function twoPlayers(team0?: Player["team"], team1?: Player["team"]): Player[] {
  return [
    { id: 0, name: "Alice", team: team0 },
    { id: 1, name: "Bob", team: team1 },
  ];
}

describe("checkSinkResult", () => {
  it("9-ball: sinking the 9 wins, no turn switch", () => {
    const res = checkSinkResult("9ball", twoPlayers(), 0, [1, 2, 3], 9);
    expect(res.win).toBe(true);
    expect(res.lose).toBe(false);
    expect(res.switchTurn).toBe(false);
    expect(res.message).toContain("9-ball");
    expect(res.message).toContain("Alice");
  });

  it("9-ball: sinking any other ball is neutral (no win/lose)", () => {
    const res = checkSinkResult("9ball", twoPlayers(), 0, [], 3);
    expect(res).toEqual({ win: false, lose: false, message: "", switchTurn: false });
  });

  it("8-ball: golden break — 8 sunk as the very first ball wins", () => {
    // sunkBalls is empty at the moment of the sink → golden break.
    const res = checkSinkResult("8ball", twoPlayers(), 0, [], EIGHT_BALL);
    expect(res.win).toBe(true);
    expect(res.lose).toBe(false);
    expect(res.message).toContain("GOLDEN BREAK");
  });

  it("8-ball: pocketing the 8 with no team yet is an early loss", () => {
    // Balls already down but no group established → premature 8 = loss.
    const res = checkSinkResult("8ball", twoPlayers(), 0, [1, 2], EIGHT_BALL);
    expect(res.lose).toBe(true);
    expect(res.win).toBe(false);
    expect(res.message).toContain("early");
  });

  it("8-ball: 8 sunk after clearing your group wins", () => {
    // Alice is solids and every solid (1-7) is already down → legal 8 = win.
    const res = checkSinkResult("8ball", twoPlayers("solids", "stripes"), 0, [...SOLIDS], EIGHT_BALL);
    expect(res.win).toBe(true);
    expect(res.lose).toBe(false);
    expect(res.message).toContain("WINNER");
  });

  it("8-ball: 8 sunk with your group still on the table is a loss", () => {
    // Alice is solids but only 1,2 are down → 8 is too early = loss.
    const res = checkSinkResult("8ball", twoPlayers("solids", "stripes"), 0, [1, 2], EIGHT_BALL);
    expect(res.lose).toBe(true);
    expect(res.win).toBe(false);
    expect(res.message).toContain("too early");
  });

  it("8-ball: sinking a non-8 ball is neutral", () => {
    const res = checkSinkResult("8ball", twoPlayers("solids", "stripes"), 0, [], 3);
    expect(res).toEqual({ win: false, lose: false, message: "", switchTurn: false });
  });

  it("practice: nothing is ever a win or loss", () => {
    expect(checkSinkResult("practice", [{ id: 0, name: "Solo" }], 0, [], 8)).toEqual({
      win: false,
      lose: false,
      message: "",
      switchTurn: false,
    });
  });
});

describe("assignTeams", () => {
  it("2-player: sinker takes the group, opponent gets the opposite", () => {
    // Alice sinks a stripe → Alice stripes, Bob solids.
    const updated = assignTeams(twoPlayers(), 0, 9);
    expect(updated[0].team).toBe("stripes");
    expect(updated[1].team).toBe("solids");
  });

  it("2-player: sinking a solid mirrors the assignment", () => {
    // Bob (index 1) sinks a solid → Bob solids, Alice stripes.
    const updated = assignTeams(twoPlayers(), 1, 3);
    expect(updated[1].team).toBe("solids");
    expect(updated[0].team).toBe("stripes");
  });

  it("4-player doubles: seats 0+2 share the sinker's group, 1+3 the opposite", () => {
    const players: Player[] = [
      { id: 0, name: "A" },
      { id: 1, name: "B" },
      { id: 2, name: "C" },
      { id: 3, name: "D" },
    ];
    // Player at index 0 sinks a solid → 0 & 2 solids, 1 & 3 stripes.
    const updated = assignTeams(players, 0, 5);
    expect(updated[0].team).toBe("solids");
    expect(updated[2].team).toBe("solids");
    expect(updated[1].team).toBe("stripes");
    expect(updated[3].team).toBe("stripes");
  });

  it("4-player doubles: a non-zero sinker still seats partner two seats over", () => {
    const players: Player[] = [
      { id: 0, name: "A" },
      { id: 1, name: "B" },
      { id: 2, name: "C" },
      { id: 3, name: "D" },
    ];
    // Player at index 1 sinks a stripe → 1 & 3 stripes, 0 & 2 solids.
    const updated = assignTeams(players, 1, 11);
    expect(updated[1].team).toBe("stripes");
    expect(updated[3].team).toBe("stripes");
    expect(updated[0].team).toBe("solids");
    expect(updated[2].team).toBe("solids");
  });

  it("does not mutate the input players array", () => {
    const players = twoPlayers();
    assignTeams(players, 0, 9);
    expect(players[0].team).toBeUndefined();
    expect(players[1].team).toBeUndefined();
  });
});

describe("getLegalBalls", () => {
  it("practice: every remaining ball is legal", () => {
    const legal = getLegalBalls("practice", [{ id: 0, name: "Solo" }], 0, [1, 2]);
    expect(legal).toEqual(ALL_8BALL.filter((b) => b !== 1 && b !== 2));
  });

  it("9-ball: every remaining ball is returned", () => {
    const legal = getLegalBalls("9ball", twoPlayers(), 0, [1, 2]);
    expect(legal).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it("8-ball open table (no team): all remaining balls reachable", () => {
    const legal = getLegalBalls("8ball", twoPlayers(), 0, []);
    expect(legal).toEqual(ALL_8BALL);
  });

  it("8-ball assigned group: own balls + the 8 are tappable", () => {
    // Alice is solids; 1 already down → {2..7} plus the 8.
    const legal = getLegalBalls("8ball", twoPlayers("solids", "stripes"), 0, [1]);
    expect(legal).toEqual([2, 3, 4, 5, 6, 7, EIGHT_BALL]);
  });

  it("8-ball group cleared: only the 8 is legal", () => {
    const legal = getLegalBalls("8ball", twoPlayers("solids", "stripes"), 0, [...SOLIDS]);
    expect(legal).toEqual([EIGHT_BALL]);
  });

  it("8-ball assigned group never offers a ball already sunk by the opponent", () => {
    // Alice solids; some of her solids down AND the 8 still live.
    const legal = getLegalBalls("8ball", twoPlayers("solids", "stripes"), 0, [1, 2, 9, 10]);
    expect(legal).toEqual([3, 4, 5, 6, 7, EIGHT_BALL]);
  });
});

describe("getLowestBall (9-ball lowest-ball rule)", () => {
  it("returns the lowest remaining ball", () => {
    expect(getLowestBall([])).toBe(1);
    expect(getLowestBall([1, 2])).toBe(3);
    expect(getLowestBall([1, 2, 3, 4, 5, 6, 7, 8])).toBe(9);
  });

  it("returns 0 when nothing remains", () => {
    expect(getLowestBall([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe(0);
  });
});

/** Minimal solo-vs-Shark GameState for the Shark-rule tests. */
function makeSharkState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: "playing",
    gameType: "8ball",
    players: [{ id: 0, name: "Alice" }],
    currentPlayerIndex: 0,
    sunkBalls: [],
    shotLog: [],
    gameStartTime: 0,
    firstActionTime: null,
    timerStartTime: null,
    lastActionTime: null,
    winner: null,
    winMessage: "",
    shareCode: "ABCDE",
    teamAssigned: false,
    sharkAggression: "normal",
    sharkSunkBalls: [],
    pendingSharkPick: false,
    undoCount: 0,
    ...overrides,
  };
}

describe("getSharkPickCandidates", () => {
  it("open table: all remaining non-8 balls minus what the Shark already has", () => {
    const state = makeSharkState({ sunkBalls: [1, 9], sharkSunkBalls: [9] });
    const candidates = getSharkPickCandidates(state);
    expect(candidates).not.toContain(EIGHT_BALL);
    expect(candidates).not.toContain(9); // already the Shark's
    expect(candidates).not.toContain(1); // already off the table
    expect(candidates).toContain(2);
    expect(candidates).toContain(10);
  });

  it("after teams assigned: Shark may only take from its own (opposite) group", () => {
    // Alice solids → Shark is stripes; candidates limited to live stripes.
    const state = makeSharkState({
      teamAssigned: true,
      players: [{ id: 0, name: "Alice", team: "solids" }],
      sunkBalls: [],
      sharkSunkBalls: [],
    });
    const candidates = getSharkPickCandidates(state);
    expect(candidates.every((b) => STRIPES.includes(b))).toBe(true);
    expect(candidates).toEqual(STRIPES);
  });
});

describe("applySharkMiss aggression triggers", () => {
  it("normal aggression: a miss does nothing", () => {
    const state = makeSharkState({ sharkAggression: "normal" });
    expect(applySharkMiss(state, "miss")).toBe(state);
  });

  it("normal aggression: a foul queues a Shark pick", () => {
    const state = makeSharkState({ sharkAggression: "normal" });
    const next = applySharkMiss(state, "foul");
    expect(next.pendingSharkPick).toBe(true);
  });

  it("hard aggression: a miss also queues a Shark pick", () => {
    const state = makeSharkState({ sharkAggression: "hard" });
    const next = applySharkMiss(state, "miss");
    expect(next.pendingSharkPick).toBe(true);
  });

  it("returns state unchanged for a non-Shark game", () => {
    const state = makeSharkState({ sharkAggression: undefined });
    expect(applySharkMiss(state, "foul")).toBe(state);
  });

  it("Shark takes the 8 and wins when it has no other legal ball (only 8 left)", () => {
    // Everything except the 8 is down → Shark's only legal target is the 8.
    const allButEight = ALL_8BALL.filter((b) => b !== EIGHT_BALL);
    const state = makeSharkState({
      sunkBalls: allButEight,
      sharkSunkBalls: STRIPES,
    });
    const next = applySharkMiss(state, "foul");
    expect(next.phase).toBe("ended");
    expect(next.winner).toBe(SHARK_PLAYER_NAME);
    expect(next.shotLog.at(-1)?.note).toContain("Shark wins");
  });

  it("Shark takes the 8 and wins after clearing its own group while the player still has balls", () => {
    // Alice solids with solids still on the table; Shark has cleared all stripes.
    const state = makeSharkState({
      teamAssigned: true,
      players: [{ id: 0, name: "Alice", team: "solids" }],
      sunkBalls: [...STRIPES, 1, 2],
      sharkSunkBalls: [...STRIPES],
    });
    const next = applySharkMiss(state, "foul");
    expect(next.phase).toBe("ended");
    expect(next.winner).toBe(SHARK_PLAYER_NAME);
  });
});

describe("resolveSharkPick", () => {
  it("moves the chosen ball to the Shark's pile and clears the pending flag", () => {
    const state = makeSharkState({ sunkBalls: [1], sharkSunkBalls: [], pendingSharkPick: true });
    const next = resolveSharkPick(state, 10);
    expect(next.sunkBalls).toContain(10);
    expect(next.sharkSunkBalls).toContain(10);
    expect(next.pendingSharkPick).toBe(false);
  });

  it("logs the steal under the Shark's name as a sink with the ball number", () => {
    const state = makeSharkState({ pendingSharkPick: true });
    const next = resolveSharkPick(state, 12);
    const last = next.shotLog.at(-1)!;
    expect(last.playerName).toBe(SHARK_PLAYER_NAME);
    expect(last.type).toBe("sink");
    expect(last.ball).toBe(12);
  });

  it("starts the pace clock on the first pocket if it hasn't started", () => {
    const state = makeSharkState({ timerStartTime: null, pendingSharkPick: true });
    const next = resolveSharkPick(state, 11);
    expect(next.timerStartTime).not.toBeNull();
  });

  it("preserves an already-running pace clock", () => {
    const state = makeSharkState({ timerStartTime: 5000, pendingSharkPick: true });
    const next = resolveSharkPick(state, 11);
    expect(next.timerStartTime).toBe(5000);
  });
});
