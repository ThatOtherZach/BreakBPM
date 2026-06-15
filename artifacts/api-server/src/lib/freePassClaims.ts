import { and, eq, sql } from "drizzle-orm";
import {
  db,
  freePassClaimPoolsTable,
  freePassClaimsTable,
  type FreePassClaim,
} from "@workspace/db";

/**
 * Landing-page free-pass giveaway pools. Two rewards — a Lucky Break roll or a
 * Day pass — each with an independent monthly cap (see `freePassMonthlyCap` in
 * config.ts). Stock is an atomic counter per (periodKey, rewardKind); a new
 * calendar month is a new `periodKey`, so stock "resets" on the 1st with no job.
 */
export const FREE_PASS_REWARD_KINDS = ["lucky_break", "day"] as const;
export type FreePassRewardKind = (typeof FREE_PASS_REWARD_KINDS)[number];

/** The discount-code grant kind each reward mints. */
export function grantKindForReward(rewardKind: FreePassRewardKind): "lucky_break" | "day" {
  return rewardKind === "lucky_break" ? "lucky_break" : "day";
}

/** Calendar period key "YYYY-MM" (UTC) — the monthly stock bucket. */
export function currentPeriodKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

const MONTH_ABBR = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

/** "2026-06" → "JUN26" for the human/URL-safe code label. */
function periodLabel(periodKey: string): string {
  const [y, m] = periodKey.split("-");
  const abbr = MONTH_ABBR[Number(m) - 1] ?? m ?? "";
  return `${abbr}${(y ?? "").slice(2)}`;
}

/**
 * URL-safe single-use code label, e.g. "LB-JUN26-001" / "D-JUN26-001". Only
 * `[A-Z0-9-]`, so it survives a `/redeem/:code` share link without escaping.
 */
export function claimCodeLabel(
  rewardKind: FreePassRewardKind,
  periodKey: string,
  sequence: number,
): string {
  const prefix = rewardKind === "lucky_break" ? "LB" : "D";
  return `${prefix}-${periodLabel(periodKey)}-${String(sequence).padStart(3, "0")}`;
}

export interface PoolDraw {
  rewardKind: FreePassRewardKind;
  /** 1-based sequence within the (periodKey, rewardKind) pool. */
  sequence: number;
}

/**
 * Atomically claim one slot from a specific reward pool. Lazily creates the
 * pool row, then does a guarded increment
 * (`SET claimed_count = claimed_count + 1 WHERE claimed_count < cap RETURNING
 * claimed_count`) — the same proven pattern as the discount-code cap claim, so
 * concurrent claims can never oversell. Returns the new 1-based count (the
 * sequence label) or null when the pool is full. Runs inside the caller's tx.
 */
async function tryClaimPoolSlotTx(
  tx: Pick<typeof db, "insert" | "update">,
  periodKey: string,
  rewardKind: FreePassRewardKind,
  cap: number,
): Promise<number | null> {
  await tx
    .insert(freePassClaimPoolsTable)
    .values({ periodKey, rewardKind })
    .onConflictDoNothing();
  const claimed = await tx
    .update(freePassClaimPoolsTable)
    .set({
      claimedCount: sql`${freePassClaimPoolsTable.claimedCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(freePassClaimPoolsTable.periodKey, periodKey),
        eq(freePassClaimPoolsTable.rewardKind, rewardKind),
        sql`${freePassClaimPoolsTable.claimedCount} < ${cap}`,
      ),
    )
    .returning({ claimedCount: freePassClaimPoolsTable.claimedCount });
  return claimed.length > 0 ? claimed[0]!.claimedCount : null;
}

/**
 * Draw a reward that still has stock for the period. Tries the two pools in a
 * random order (so the giveaway mixes Lucky Break + Day rather than draining
 * one first) and falls back to the other when the first is full. Returns null
 * only when BOTH pools are exhausted. Runs inside the caller's tx.
 */
export async function drawFreePassRewardTx(
  tx: Pick<typeof db, "insert" | "update">,
  periodKey: string,
  cap: number,
): Promise<PoolDraw | null> {
  const order: FreePassRewardKind[] =
    Math.random() < 0.5 ? ["lucky_break", "day"] : ["day", "lucky_break"];
  for (const rewardKind of order) {
    const sequence = await tryClaimPoolSlotTx(tx, periodKey, rewardKind, cap);
    if (sequence !== null) return { rewardKind, sequence };
  }
  return null;
}

/** The caller's prior claim (one-per-account, ever), if any. */
export async function getFreePassClaimForUser(
  userId: string,
): Promise<FreePassClaim | undefined> {
  const [row] = await db
    .select()
    .from(freePassClaimsTable)
    .where(eq(freePassClaimsTable.userId, userId))
    .limit(1);
  return row;
}

/** Remaining stock per pool for the period (clamped to >= 0). */
export async function getRemainingStock(
  periodKey: string,
  cap: number,
): Promise<Record<FreePassRewardKind, number>> {
  const rows = await db
    .select({
      rewardKind: freePassClaimPoolsTable.rewardKind,
      claimedCount: freePassClaimPoolsTable.claimedCount,
    })
    .from(freePassClaimPoolsTable)
    .where(eq(freePassClaimPoolsTable.periodKey, periodKey));
  const remaining: Record<FreePassRewardKind, number> = {
    lucky_break: cap,
    day: cap,
  };
  for (const r of rows) {
    const kind = r.rewardKind as FreePassRewardKind;
    if (kind in remaining) {
      remaining[kind] = Math.max(0, cap - r.claimedCount);
    }
  }
  return remaining;
}
