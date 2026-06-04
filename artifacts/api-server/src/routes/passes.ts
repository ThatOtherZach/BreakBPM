import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  discountCodesTable,
  discountRedemptionsTable,
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

  let pass: Pass;
  try {
    pass = await db.transaction(async (tx): Promise<Pass> => {
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

      const issued = await issuePassTx(tx, {
        userId: user.id,
        kind: discount.grantsPassKind as PassKind,
        source: "discount_code",
        sourceRef: code,
      });

      // A code can grant Lifetime — apply the same mutual exclusion as the
      // purchase/grant paths so an active subscription stops renewing.
      if (issued.kind === "lifetime") {
        await stopRenewingActiveSubscriptionsTx(tx, user.id);
      }

      // Insert the redemption AFTER the pass so we can wire passId
      // correctly. The unique (code, user_id) index catches duplicate
      // redeems; the throw below rolls back BOTH the pass insert and
      // the cap increment so partial entitlement state can never leak.
      try {
        await tx.insert(discountRedemptionsTable).values({
          id: newId(),
          code,
          userId: user.id,
          passId: issued.id,
        });
      } catch (e) {
        if ((e as { code?: string }).code === "23505") {
          throw new RedeemFailure("You've already redeemed this code");
        }
        throw e;
      }
      return issued;
    });
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
    { userId: user.id, code, passKind: pass.kind },
    "Discount code redeemed",
  );
  // Mirror the local mutual-exclusion to Stripe: a redeemed Lifetime must also
  // stop a real subscription from renewing (best-effort, outside the tx).
  if (pass.kind === "lifetime") {
    await stopRenewingStripeSubscriptions(user.id);
  }
  res.json(
    RedeemDiscountCodeResponse.parse({
      success: true,
      message: `Granted ${pass.kind} pass`,
      pass: passToSummary(pass),
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
  const result = await listMyGiftCodes(user.id);
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
    const result = await generateGiftCode(user.id);
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

export default router;
