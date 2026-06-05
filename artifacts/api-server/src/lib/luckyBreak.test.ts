import { describe, it, expect } from "vitest";
import {
  canonicalizeEntropy,
  hashHex,
  unitFromHashHex,
  rollFromHashHex,
  computeLuckyBreakRoll,
  LUCKY_BREAK_LIFETIME_PROBABILITY,
  type EntropyShot,
} from "./luckyBreak";

const sampleShots: EntropyShot[] = [
  { gameId: "g1", ts: 1000, ball: 3, type: "sink" },
  { gameId: "g1", ts: 2000, ball: null, type: "miss" },
  { gameId: "g2", ts: 1500, ball: 8, type: "win" },
];

describe("canonicalizeEntropy", () => {
  it("is order-independent", () => {
    const a = canonicalizeEntropy(sampleShots);
    const b = canonicalizeEntropy([...sampleShots].reverse());
    expect(a).toBe(b);
  });

  it("renders null balls as empty and is stable", () => {
    expect(canonicalizeEntropy([{ gameId: "g1", ts: 2000, ball: null, type: "miss" }])).toBe(
      "g1:2000::miss",
    );
  });

  it("returns empty string for no shots", () => {
    expect(canonicalizeEntropy([])).toBe("");
  });
});

describe("unitFromHashHex", () => {
  it("maps into [0,1)", () => {
    for (const s of ["g1", "abc", "zzz", "0", "ffffffffffffff"]) {
      const v = unitFromHashHex(hashHex(s));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("maps all-zero digits to 0 and all-f digits near 1", () => {
    expect(unitFromHashHex("0".repeat(64))).toBe(0);
    expect(unitFromHashHex("f".repeat(64))).toBeCloseTo(1, 5);
    expect(unitFromHashHex("f".repeat(64))).toBeLessThan(1);
  });
});

describe("rollFromHashHex", () => {
  it("is lifetime strictly below the probability, monthly at/above", () => {
    // Hand-craft digests whose first 13 hex digits map to known values.
    const max = Math.pow(16, 13);
    const below = Math.floor(0.1 * max).toString(16).padStart(13, "0") + "0".repeat(51);
    const above = Math.floor(0.5 * max).toString(16).padStart(13, "0") + "0".repeat(51);
    expect(rollFromHashHex(below, 0.2).outcome).toBe("lifetime");
    expect(rollFromHashHex(above, 0.2).outcome).toBe("month");
  });

  it("never grants lifetime at probability 0", () => {
    expect(rollFromHashHex("f".repeat(64), 0).outcome).toBe("month");
    expect(rollFromHashHex("0".repeat(64), 0).outcome).toBe("month");
  });
});

describe("computeLuckyBreakRoll", () => {
  it("is deterministic for the same inputs", () => {
    const a = computeLuckyBreakRoll(sampleShots, "redemption-1");
    const b = computeLuckyBreakRoll([...sampleShots].reverse(), "redemption-1");
    expect(a.seedHash).toBe(b.seedHash);
    expect(a.outcome).toBe(b.outcome);
    expect(a.value).toBe(b.value);
  });

  it("changes the seed when the redemption id changes", () => {
    const a = computeLuckyBreakRoll(sampleShots, "redemption-1");
    const b = computeLuckyBreakRoll(sampleShots, "redemption-2");
    expect(a.seedHash).not.toBe(b.seedHash);
  });

  it("produces a valid roll even with no shot data", () => {
    const r = computeLuckyBreakRoll([], "redemption-x");
    expect(r.entropyShotCount).toBe(0);
    expect(["month", "lifetime"]).toContain(r.outcome);
    expect(r.value).toBeGreaterThanOrEqual(0);
    expect(r.value).toBeLessThan(1);
  });

  it("never grants below the Monthly floor", () => {
    for (let i = 0; i < 200; i++) {
      const r = computeLuckyBreakRoll(sampleShots, `rid-${i}`);
      expect(["month", "lifetime"]).toContain(r.outcome);
    }
  });

  it("approximates the disclosed odds over many rolls", () => {
    let lifetimes = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      if (computeLuckyBreakRoll(sampleShots, `seed-${i}`).outcome === "lifetime") {
        lifetimes += 1;
      }
    }
    const rate = lifetimes / N;
    // Wide tolerance — this is a sanity check on uniformity, not an exact test.
    expect(rate).toBeGreaterThan(LUCKY_BREAK_LIFETIME_PROBABILITY - 0.04);
    expect(rate).toBeLessThan(LUCKY_BREAK_LIFETIME_PROBABILITY + 0.04);
  });
});
