import { createHash } from "crypto";

/**
 * Lucky Break roll engine — PURE and deterministic. No DB, no clock, no
 * randomness source other than the inputs handed in. This is what makes the
 * fairness model auditable: given the same shot data and redemption id, the
 * roll always lands the same way.
 *
 * Fairness model
 * --------------
 * Every Lucky Break grants AT LEAST a Monthly pass. A fixed, disclosed share
 * of rolls upgrade to Lifetime. Shot data is used as ENTROPY only — it SEEDS
 * the draw, it never shifts the odds. A player with more (or "better") shots
 * does not improve their Lifetime chance; their shots simply make the seed
 * unpredictable.
 *
 * The recipe:
 *   1. Take the last-30-days shot rows (globally), canonicalize them into a
 *      stable string (`canonicalizeEntropy`).
 *   2. Fold in the roll's server-assigned redemption id so two rolls over the
 *      same shot data still differ, and a caller can't predict their result.
 *   3. SHA-256 the combined seed → hex digest.
 *   4. Map the digest into [0,1) (`unitFromHashHex`).
 *   5. Lifetime if the value is below the disclosed probability, else Monthly.
 *
 * The DB read that produces the shot rows lives in `luckyBreakEntropy.ts`; the
 * redeem flow stores the seedHash + outcome so any roll can be re-verified.
 */

export type LuckyBreakOutcome = "month" | "lifetime";

/**
 * Sentinel `grantsPassKind` value that marks a discount code as a Lucky Break
 * roll rather than a fixed-tier grant. Redeeming a code with this kind runs
 * the seeded draw instead of issuing a predetermined pass.
 */
export const LUCKY_BREAK_CODE_KIND = "lucky_break";

/** Default disclosed odds: 20% of rolls upgrade to Lifetime; the other 80%
 * land on the guaranteed Monthly floor. This is the fallback default only —
 * operators retune the live odds via the `BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY`
 * env var (see `luckyBreakLifetimeProbability()` in `config.ts`), which the roll
 * call sites pass in so this pure engine stays env-free. */
export const LUCKY_BREAK_LIFETIME_PROBABILITY = 0.2;

/** Entropy window: the draw is seeded by the last 30 days of shot data. */
export const LUCKY_BREAK_WINDOW_DAYS = 30;

/** One pocket/miss/foul/safety event distilled to its entropy-bearing fields. */
export interface EntropyShot {
  gameId: string;
  /** Millisecond timestamp of the shot. */
  ts: number;
  /** Pocketed ball number, or null for non-pocket events. */
  ball: number | null;
  type: string;
}

/**
 * Canonical, order-stable serialization of the entropy shot rows. Sorting
 * makes the digest independent of the row order the DB happened to return, so
 * the same underlying shot data always yields the same seed.
 */
export function canonicalizeEntropy(shots: EntropyShot[]): string {
  const sorted = [...shots].sort(
    (a, b) =>
      a.ts - b.ts ||
      a.gameId.localeCompare(b.gameId) ||
      (a.ball ?? -1) - (b.ball ?? -1) ||
      a.type.localeCompare(b.type),
  );
  return sorted
    .map((s) => `${s.gameId}:${s.ts}:${s.ball ?? ""}:${s.type}`)
    .join("|");
}

/** SHA-256 of `input`, as a lowercase hex digest. */
export function hashHex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Map a SHA-256 hex digest into the half-open interval [0,1). Uses the first
 * 13 hex digits (52 bits) — the largest slice that fits exactly in a JS double
 * (< 2^53) — divided by 16^13. Uniform across the digest space.
 */
export function unitFromHashHex(hex: string): number {
  const slice = hex.slice(0, 13);
  const intVal = parseInt(slice, 16);
  return intVal / Math.pow(16, 13);
}

export interface HashRoll {
  value: number;
  outcome: LuckyBreakOutcome;
}

/** Decide the outcome from an already-computed digest. Lifetime iff the mapped
 * value is strictly below the disclosed probability. */
export function rollFromHashHex(
  hex: string,
  lifetimeProbability: number = LUCKY_BREAK_LIFETIME_PROBABILITY,
): HashRoll {
  const value = unitFromHashHex(hex);
  return { value, outcome: value < lifetimeProbability ? "lifetime" : "month" };
}

export interface LuckyBreakRollResult {
  seedHash: string;
  value: number;
  outcome: LuckyBreakOutcome;
  lifetimeProbability: number;
  entropyShotCount: number;
}

/**
 * Full roll: canonicalize the shot entropy, fold in the redemption id, hash,
 * and draw. Always produces a valid result — even with zero shots the
 * redemption id alone seeds a well-formed draw.
 */
export function computeLuckyBreakRoll(
  shots: EntropyShot[],
  redemptionId: string,
  lifetimeProbability: number = LUCKY_BREAK_LIFETIME_PROBABILITY,
): LuckyBreakRollResult {
  const canonical = canonicalizeEntropy(shots);
  // `lb1` namespaces the seed format so it can be versioned later without
  // colliding with any previously-stored seedHash.
  const seedInput = `lb1|${canonical}|rid:${redemptionId}`;
  const seedHash = hashHex(seedInput);
  const { value, outcome } = rollFromHashHex(seedHash, lifetimeProbability);
  return {
    seedHash,
    value,
    outcome,
    lifetimeProbability,
    entropyShotCount: shots.length,
  };
}
