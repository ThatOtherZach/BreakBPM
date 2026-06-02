import { describe, it, expect } from "vitest";
import {
  calculatePlayerBPM,
  calculatePlayerAccuracy,
  playerAccuracyCounts,
  SHARK_PLAYER_NAME,
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
