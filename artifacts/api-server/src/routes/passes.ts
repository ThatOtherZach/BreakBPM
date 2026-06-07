import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  discountCodesTable,
  discountRedemptionsTable,
  luckyBreakRollsTable,
  type PassKind,
} from "@workspace/db";
import {
  RedeemDiscountCodeBody,
  RedeemDiscountCodeResponse,
  CreatePassCheckoutBody,
  CreatePassCheckoutResponse,
  VerifyPassCheckoutBody,
  VerifyPassCheckoutResponse,
  GenerateGiftCodeResponse,
  ListMyGiftCodesResponse,
  CreateAdminDiscountCodeBody,
  CreateAdminDiscountCodeResponse,
  ListAdminDiscountCodesResponse,
} from "@workspace/api-zod";
import { getOrCreateUser } from "../lib/auth";
import { issuePassTx, grantPurchasedPassTx } from "../lib/passes";
import { stopRenewingActiveSubscriptionsTx } from "../lib/subscriptions";
import { getActivePasses } from "../lib/entitlement";
import {
  paymentProvider,
  stopRenewingStripeSubscriptions,
} from "../lib/paymentProvider";
import { newId } from "../lib/ids";
import {
  generateGiftCode,
  listMyGiftCodes,
  GiftCodeFailure,
} from "../lib/giftCodes";
import {
  createAdminDiscountCode,
  listAdminDiscountCodes,
  ADMIN_GRANTABLE_KINDS,
} from "../lib/adminCodes";
import {
  cardPaymentsEnabled,
  CARD_PAYMENTS_OFF_MESSAGE,
  isAdminEmail,
} from "../lib/config";
import {
  LUCKY_BREAK_CODE_KIND,
  LUCKY_BREAK_WINDOW_DAYS,
  computeLuckyBreakRoll,
  type EntropyShot,
  type LuckyBreakRollResult,
} from "../lib/luckyBreak";
import { gatherShotEntropy } from "../lib/luckyBreakEntropy";

const router: IRouter = Router();

// See entitlement.ts for the canonical lifetime expiry sentinel. We
// duplicate the literal here to keep this helper free of cross-module
// coupling; if you change one, change both.
const LIFETIME_EXPIRES_AT = new Date("9999-12-31T23:59:59.999Z");

function passToSummary(pass: { kind: string; startedAt: Date; durationSeconds: number | null }) {
  return {
    kind: pass.kind as PassKind,
    startedAt: pass.startedAt,
    expiresAt:
      pass.durationSeconds === null
        ? LIFETIME_EXPIRES_AT
        : new Date(pass.startedAt.getTime() + pass.durationSeconds * 1000),
    isLifetime: pass.kind === "lifetime",
  };
}

/**
 * Discount-code redemption — does NOT touch the payment provider.
 *
 * The whole validate / decrement-cap / insert-redemption / issue-pass
 * sequence runs inside a single transaction so the user can never end up
 * with two passes from one code under concurrent requests. The unique
 * (code, user_id) index on discount_redemptions provides the second line
 * of defence — if two transactions race past the SELECT, the loser's
 * INSERT fails and the whole tx rolls back, so no orphan pass row remains.
 */
router.post("/passes/redeem", async (req, res): Promise<void> => {
  const parsed = RedeemDiscountCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to redeem a code" });
    return;
  }

  const code = parsed.data.code.trim().toUpperCase();

  // Block redemption while any pass is already active. We check BEFORE
  // opening the transaction so a refused attempt doesn't burn the code's
  // single-redemption slot — the cap UPDATE below would otherwise increment
  // redemption_count and then roll back, but reading the row inside the tx
  // and then aborting is wasted work compared to this cheap pre-check.
  const existing = await getActivePasses(user.id);
  if (existing.length > 0) {
    res.json(
      RedeemDiscountCodeResponse.parse({
        success: false,
        message: "You already have an active pass.",
      }),
    );
    return;
  }

  // The redemption id is assigned up-front so it can be folded into the Lucky
  // Break seed (making each roll unique + unpredictable) AND used as the
  // discount_redemptions primary key, tying the roll record to the redemption.
  const redemptionId = newId();

  // Peek (non-locking) to learn whether this is a Lucky Break code so we can
  // gather the potentially-large shot entropy BEFORE opening the write
  // transaction. The authoritative validation still happens under FOR UPDATE
  // inside the tx; this read only decides whether to pay for entropy.
  const [peek] = await db
    .select({ kind: discountCodesTable.grantsPassKind })
    .from(discountCodesTable)
    .where(eq(discountCodesTable.code, code))
    .limit(1);
  const isLuckyBreak = peek?.kind === LUCKY_BREAK_CODE_KIND;
  const entropy: EntropyShot[] = isLuckyBreak ? await gatherShotEntropy() : [];

  // We use a thrown sentinel for any "validation failed" path INSIDE the
  // transaction so that pg rolls back any writes that already happened
  // (e.g. the cap-claim UPDATE) before we hit the failure. Returning a
  // non-throw result from inside the tx callback would commit those
  // writes, which would leak entitlement state on the duplicate-redeem
  // path.
  class RedeemFailure extends Error {
    constructor(public reason: string) { super(reason); }
  }

  type Pass = { kind: string; startedAt: Date; durationSeconds: number | null };
  type RedeemTxResult = { pass: Pass; roll: LuckyBreakRollResult | null };

  let pass: Pass;
  let roll: LuckyBreakRollResult | null;
  try {
    ({ pass, roll } = await db.transaction(async (tx): Promise<RedeemTxResult> => {
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

      // Atomic cap claim: this UPDATE only succeeds if the cap allows it.
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

      // Lucky Break: SEED the draw from the pre-gathered shot entropy folded
      // with this redemption's id. The roll happens exactly once, here, inside
      // the same tx that grants the pass — there is no separate "roll" call to
      // retry, so a player can never re-roll a result they didn't like. The
      // outcome is the pass kind to issue ("month" floor or "lifetime").
      let rollResult: LuckyBreakRollResult | null = null;
      let kindToIssue: PassKind;
      if (discount.grantsPassKind === LUCKY_BREAK_CODE_KIND) {
        rollResult = computeLuckyBreakRoll(entropy, redemptionId);
        kindToIssue = rollResult.outcome;
      } else {
        kindToIssue = discount.grantsPassKind as PassKind;
      }

      const issued = await issuePassTx(tx, {
        userId: user.id,
        kind: kindToIssue,
        source: "discount_code",
        sourceRef: code,
      });

      // A code (or a Lucky Break roll) can grant Lifetime — apply the same
      // mutual exclusion as the purchase/grant paths so an active subscription
      // stops renewing.
      if (issued.kind === "lifetime") {
        await stopRenewingActiveSubscriptionsTx(tx, user.id);
      }

      // Insert the redemption AFTER the pass so we can wire passId
      // correctly. The unique (code, user_id) index catches duplicate
      // redeems; the throw below rolls back the pass insert, the cap
      // increment, and any Lucky Break record so partial state can never leak.
      try {
        await tx.insert(discountRedemptionsTable).values({
          id: redemptionId,
          code,
          userId: user.id,
          passId: issued.id,
        });
      } catch (e) {
        // drizzle wraps the pg error, so the SQLSTATE can sit on the cause
        // rather than the top-level error. Check both so the unique
        // (code, user_id) violation maps to a friendly refusal instead of a
        // 500.
        const sqlState =
          (e as { code?: string }).code ??
          (e as { cause?: { code?: string } }).cause?.code;
        if (sqlState === "23505") {
          throw new RedeemFailure("You've already redeemed this code");
        }
        throw e;
      }

      // Persist the audit trail in the same tx so the roll is reproducible and
      // can never be silently re-rolled. rolledValuePpm/lifetimeProbabilityBps
      // are integer-scaled so the [0,1) draw and odds round-trip exactly.
      if (rollResult) {
        await tx.insert(luckyBreakRollsTable).values({
          id: newId(),
          userId: user.id,
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

      return { pass: issued, roll: rollResult };
    }));
  } catch (err) {
    if (err instanceof RedeemFailure) {
      res.json(RedeemDiscountCodeResponse.parse({ success: false, message: err.reason }));
      return;
    }
    req.log.error({ err, code, userId: user.id }, "Redeem failed");
    res.status(500).json({ error: "Redeem failed" });
    return;
  }

  req.log.info(
    {
      userId: user.id,
      code,
      passKind: pass.kind,
      luckyBreak: roll
        ? { outcome: roll.outcome, seedHash: roll.seedHash, shots: roll.entropyShotCount }
        : undefined,
    },
    roll ? "Lucky Break code redeemed" : "Discount code redeemed",
  );
  // Mirror the local mutual-exclusion to Stripe: a redeemed Lifetime must also
  // stop a real subscription from renewing (best-effort, outside the tx).
  if (pass.kind === "lifetime") {
    await stopRenewingStripeSubscriptions(user.id);
  }
  res.json(
    RedeemDiscountCodeResponse.parse({
      success: true,
      message: roll
        ? roll.outcome === "lifetime"
          ? "JACKPOT — you rolled a Lifetime pass!"
          : "Nice break — you rolled a Monthly pass!"
        : `Granted ${pass.kind} pass`,
      pass: passToSummary(pass),
      luckyBreak: roll
        ? {
            outcome: roll.outcome,
            lifetimeProbability: roll.lifetimeProbability,
            windowDays: LUCKY_BREAK_WINDOW_DAYS,
            seedHash: roll.seedHash,
            seededShotCount: roll.entropyShotCount,
          }
        : undefined,
    }),
  );
});

/** Begin a paid checkout. The provider returns an opaque token (and optional URL). */
router.post("/passes/checkout", async (req, res): Promise<void> => {
  const parsed = CreatePassCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to purchase a pass" });
    return;
  }
  if (!cardPaymentsEnabled()) {
    res.json(
      CreatePassCheckoutResponse.parse({
        success: false,
        message: CARD_PAYMENTS_OFF_MESSAGE,
      }),
    );
    return;
  }
  const result = await paymentProvider.createCheckout({
    userId: user.id,
    kind: parsed.data.kind,
  });
  res.json(CreatePassCheckoutResponse.parse(result));
});

/** Hand the opaque token back; provider verifies and the pass is granted. */
router.post("/passes/verify", async (req, res): Promise<void> => {
  const parsed = VerifyPassCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to verify a pass" });
    return;
  }
  if (!cardPaymentsEnabled()) {
    res.json(
      VerifyPassCheckoutResponse.parse({
        success: false,
        message: CARD_PAYMENTS_OFF_MESSAGE,
      }),
    );
    return;
  }
  const verify = await paymentProvider.verifyAndGrant(
    parsed.data.opaqueToken,
    user.id,
  );
  if (!verify.success || !verify.kind) {
    res.json(VerifyPassCheckoutResponse.parse({ success: false, message: verify.message }));
    return;
  }
  // Idempotent grant — the webhook may have already granted this same
  // purchase. Dedup is keyed on the provider payment reference. Lifetime's
  // local subscription mutual-exclusion is applied inside the helper.
  const { pass, deduped } = await db.transaction((tx) =>
    grantPurchasedPassTx(tx, {
      userId: user.id,
      kind: verify.kind!,
      sourceRef: verify.providerRef ?? parsed.data.opaqueToken,
    }),
  );
  req.log.info(
    { userId: user.id, kind: pass.kind, deduped },
    "Pass purchase verified",
  );
  // First-time Lifetime grant also stops the real Stripe subscription from
  // renewing (best-effort, outside the tx). Skipped on dedup — the webhook or
  // an earlier verify already handled it.
  if (pass.kind === "lifetime" && !deduped) {
    await stopRenewingStripeSubscriptions(user.id);
  }
  res.json(
    VerifyPassCheckoutResponse.parse({
      success: true,
      message: verify.message,
      pass: passToSummary(pass),
    }),
  );
});

/**
 * List the caller's recently-generated Day-Pass gift codes + cooldown
 * state. Returns `eligible: false` for users without a qualifying pass so
 * the client can hide the gift section without an extra entitlement call.
 */
router.get("/passes/discount-codes", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view your gift codes" });
    return;
  }
  const result = await listMyGiftCodes(user.id, isAdminEmail(user.email));
  res.json(
    ListMyGiftCodesResponse.parse({
      eligible: result.eligible,
      codes: result.codes,
      cooldownActive: result.cooldownActive,
      nextAvailableAt: result.nextAvailableAt,
    }),
  );
});

/**
 * Mint a new single-use 24-hour Day-Pass gift code for the caller. The
 * library raises GiftCodeFailure with a reason we translate to a
 * `{ success: false, message }` body; unexpected failures bubble up as
 * 500s so they surface in logs.
 */
router.post("/passes/discount-codes", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to gift a Day Pass" });
    return;
  }
  try {
    const result = await generateGiftCode(user.id, isAdminEmail(user.email));
    // Do not log the raw code — anyone with log access could redeem it.
    // Log issuer + expiry instead so we can still trace gifting activity.
    req.log.info(
      { userId: user.id, expiresAt: result.code.expiresAt },
      "Gift Day-Pass code generated",
    );
    res.json(
      GenerateGiftCodeResponse.parse({
        success: true,
        message: "Gift code generated.",
        code: result.code,
        nextAvailableAt: result.nextAvailableAt,
      }),
    );
  } catch (err) {
    if (err instanceof GiftCodeFailure) {
      // For cooldown rejections we still need a nextAvailableAt so the
      // client can refresh its disabled state without a second round-trip.
      const fallbackNext =
        err.reason === "cooldown_active" && err.cooldownRemainingMs !== undefined
          ? new Date(Date.now() + err.cooldownRemainingMs)
          : new Date();
      res.json(
        GenerateGiftCodeResponse.parse({
          success: false,
          message: err.message,
          nextAvailableAt: fallbackNext,
        }),
      );
      return;
    }
    req.log.error({ err, userId: user.id }, "Gift code generation failed");
    res.status(500).json({ error: "Gift code generation failed" });
  }
});

/**
 * List the comp codes the calling admin has minted. 403s for non-admins so
 * the admin generator never leaks to ordinary accounts. The admin allowlist
 * itself is never returned — only the caller's own codes.
 */
router.get("/passes/admin/codes", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage admin codes" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }
  const codes = await listAdminDiscountCodes(user.id);
  res.json(ListAdminDiscountCodesResponse.parse({ codes }));
});

/**
 * Mint a new admin comp code granting the chosen tier with an optional
 * redemption cap. 403s for non-admins.
 */
router.post("/passes/admin/codes", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to mint admin codes" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }
  const parsed = CreateAdminDiscountCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const kind = parsed.data.kind;
  if (!ADMIN_GRANTABLE_KINDS.includes(kind)) {
    res.status(400).json({ error: "Unsupported pass tier" });
    return;
  }
  const maxRedemptions = parsed.data.maxRedemptions ?? null;
  if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) {
    res.status(400).json({ error: "maxRedemptions must be a positive integer or omitted" });
    return;
  }

  const code = await createAdminDiscountCode({
    issuedByUserId: user.id,
    kind,
    maxRedemptions,
  });
  // Do not log the raw code — anyone with log access could redeem it.
  req.log.info(
    { userId: user.id, kind, maxRedemptions },
    "Admin comp code generated",
  );
  res.json(CreateAdminDiscountCodeResponse.parse({ code }));
});

export default router;
