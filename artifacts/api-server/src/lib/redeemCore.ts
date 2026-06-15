import { and, eq, sql } from "drizzle-orm";
import {
  db,
  discountCodesTable,
  discountRedemptionsTable,
  luckyBreakRollsTable,
  type PassKind,
} from "@workspace/db";
import { newId } from "./ids";
import { issuePassTx } from "./passes";
import { stopRenewingActiveSubscriptionsTx } from "./subscriptions";
import { recordSaleEventTx, valuationForCodeRedemption } from "./saleEvents";
import {
  LUCKY_BREAK_CODE_KIND,
  LUCKY_BREAK_WINDOW_DAYS,
  computeLuckyBreakRoll,
  type EntropyShot,
  type LuckyBreakRollResult,
} from "./luckyBreak";
import type { UsdCadRate } from "./fx";

/**
 * Thrown for any "validation failed" path INSIDE the redeem transaction so pg
 * rolls back every write that already happened (cap increment, pass insert,
 * roll/sale rows) before we surface the failure. The `reason` is the
 * user-facing message. Returning a non-throw result from the tx callback would
 * COMMIT those partial writes and leak entitlement state, so always throw.
 */
export class RedeemFailure extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

/**
 * Inputs gathered BEFORE the transaction (network/large reads must not run
 * inside the tx): the Lucky Break shot entropy (empty for non-Lucky-Break
 * codes), the frozen USD→CAD ledger rate, and the disclosed Lifetime odds.
 */
export interface RedeemDeps {
  entropy: EntropyShot[];
  fx: UsdCadRate;
  lifetimeProbability: number;
}

type IssuedPass = { kind: string; startedAt: Date; durationSeconds: number | null };

export interface RedeemTxResult {
  pass: IssuedPass;
  roll: LuckyBreakRollResult | null;
}

/** The structural tx surface this helper needs from a db.transaction handle. */
type RedeemTx = Pick<typeof db, "select" | "update" | "insert">;

/**
 * Validate + redeem a discount code for a user inside a caller-provided
 * transaction. Shared by `/passes/redeem` (user pastes a code) and
 * `/passes/claim` (the landing-page giveaway mints a single-use code then
 * redeems it in the same tx). The whole validate → cap-claim → roll → issue →
 * record sequence is one unit so a code can never half-apply.
 *
 * Pre-tx responsibilities left to the CALLER: refusing when the user already
 * holds an active pass, and gathering `deps` (entropy/fx) before opening the tx.
 */
export async function redeemDiscountCodeForUserTx(
  tx: RedeemTx,
  params: { userId: string; code: string; redemptionId: string },
  deps: RedeemDeps,
): Promise<RedeemTxResult> {
  const { userId, code, redemptionId } = params;

  const [discount] = await tx
    .select()
    .from(discountCodesTable)
    .where(eq(discountCodesTable.code, code))
    .for("update")
    .limit(1);
  if (!discount) throw new RedeemFailure("Invalid code");
  if (discount.expiresAt && discount.expiresAt < new Date()) {
    throw new RedeemFailure("Code expired");
  }

  // Atomic cap claim: only succeeds if the redemption cap still allows it.
  const claim = await tx
    .update(discountCodesTable)
    .set({ redemptionCount: sql`${discountCodesTable.redemptionCount} + 1` })
    .where(
      and(
        eq(discountCodesTable.code, code),
        sql`(${discountCodesTable.maxRedemptions} IS NULL OR ${discountCodesTable.redemptionCount} < ${discountCodesTable.maxRedemptions})`,
      ),
    )
    .returning({ id: discountCodesTable.code });
  if (claim.length === 0) throw new RedeemFailure("Code fully redeemed");

  // Lucky Break: SEED the draw from the pre-gathered shot entropy folded with
  // this redemption's id. The roll happens exactly once, here, in the same tx
  // that grants the pass — there is no separate retryable "roll" call, so a
  // player can never re-roll a result they didn't like.
  let rollResult: LuckyBreakRollResult | null = null;
  let kindToIssue: PassKind;
  if (discount.grantsPassKind === LUCKY_BREAK_CODE_KIND) {
    rollResult = computeLuckyBreakRoll(
      deps.entropy,
      redemptionId,
      deps.lifetimeProbability,
    );
    kindToIssue = rollResult.outcome;
  } else {
    kindToIssue = discount.grantsPassKind as PassKind;
  }

  const issued = await issuePassTx(tx, {
    userId,
    kind: kindToIssue,
    source: "discount_code",
    sourceRef: code,
  });

  // A code (or Lucky Break roll) can grant Lifetime — apply the same mutual
  // exclusion as the purchase/grant paths so an active subscription stops
  // renewing (Stripe-side cancellation is the caller's job, outside the tx).
  if (issued.kind === "lifetime") {
    await stopRenewingActiveSubscriptionsTx(tx, userId);
  }

  // Insert the redemption AFTER the pass so passId is correct. The unique
  // (code, user_id) index catches duplicate redeems; the throw rolls back the
  // pass insert, cap increment, and any Lucky Break record.
  try {
    await tx.insert(discountRedemptionsTable).values({
      id: redemptionId,
      code,
      userId,
      passId: issued.id,
    });
  } catch (e) {
    // drizzle wraps the pg error, so the SQLSTATE can sit on the cause.
    const sqlState =
      (e as { code?: string }).code ??
      (e as { cause?: { code?: string } }).cause?.code;
    if (sqlState === "23505") {
      throw new RedeemFailure("You've already redeemed this code");
    }
    throw e;
  }

  // Persist the audit trail in the same tx so the roll is reproducible and can
  // never be silently re-rolled. The integer-scaled fields round-trip exactly.
  if (rollResult) {
    await tx.insert(luckyBreakRollsTable).values({
      id: newId(),
      userId,
      code,
      redemptionId,
      seedHash: rollResult.seedHash,
      rolledValuePpm: Math.round(rollResult.value * 1_000_000),
      lifetimeProbabilityBps: Math.round(rollResult.lifetimeProbability * 10_000),
      outcome: rollResult.outcome,
      entropyShotCount: rollResult.entropyShotCount,
      windowDays: LUCKY_BREAK_WINDOW_DAYS,
      passId: issued.id,
    });
  }

  // Sales ledger: one valued row per redemption, in the same tx. Lucky Break
  // codes are real revenue UNLESS minted by the free-pass claim flow
  // (issuerKind='claim'), which valuationForCodeRedemption books as a $0 comp.
  const v = valuationForCodeRedemption(discount.grantsPassKind, discount.issuerKind);
  await recordSaleEventTx(tx, {
    userId,
    eventType: "code_redemption",
    paymentMethod: "code",
    grossCents: v.grossCents,
    isComp: v.isComp,
    productLabel: v.productLabel,
    fx: deps.fx,
    providerRef: redemptionId,
  });

  return { pass: issued, roll: rollResult };
}
