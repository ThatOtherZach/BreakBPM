import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  ListPlansResponse,
  CreateSubscriptionCheckoutBody,
  CreateSubscriptionCheckoutResponse,
  VerifySubscriptionCheckoutBody,
  VerifySubscriptionCheckoutResponse,
  CancelSubscriptionResponse,
} from "@workspace/api-zod";
import { getOrCreateUser } from "../lib/auth";
import { getActivePasses, getActiveSubscription } from "../lib/entitlement";
import {
  upsertPurchasedSubscriptionTx,
  cancelSubscriptionTx,
} from "../lib/subscriptions";
import { paymentProvider } from "../lib/paymentProvider";
import {
  PLANS,
  luckyBreakInfo,
  CRYPTO_PASS_PLANS,
  DAY_PASS_PRICING,
} from "../lib/pricing";
import {
  cardPaymentsEnabled,
  CARD_PAYMENTS_OFF_MESSAGE,
  cryptoPaymentsEnabled,
} from "../lib/config";
import { cryptoConfigured, getNetworkConfig } from "../lib/cryptoChain";

const router: IRouter = Router();

async function hasLifetimePass(userId: string): Promise<boolean> {
  const passes = await getActivePasses(userId);
  return passes.some((p) => p.isLifetime);
}

/** Public plan catalog — single source of truth for prices/metadata. Also
 * tells the client whether card checkout is open and the Lucky Break terms. */
router.get("/passes/plans", async (_req, res): Promise<void> => {
  const cryptoCfg = getNetworkConfig();
  res.json(
    ListPlansResponse.parse({
      plans: PLANS,
      cardPaymentsEnabled: cardPaymentsEnabled(),
      luckyBreak: luckyBreakInfo(),
      crypto: {
        enabled: cryptoConfigured(cryptoPaymentsEnabled()),
        network: cryptoCfg.network,
        chainId: cryptoCfg.chainId,
        assets: ["usdc", "eth"],
        passes: CRYPTO_PASS_PLANS.map((p) => ({
          passKind: p.passKind,
          name: p.name,
          priceCents: p.priceCents,
        })),
        dayPass: {
          minDays: DAY_PASS_PRICING.minDays,
          maxDays: DAY_PASS_PRICING.maxDays,
          firstDayCents: DAY_PASS_PRICING.firstDayCents,
          midRateCents: DAY_PASS_PRICING.midRateCents,
          midThreshold: DAY_PASS_PRICING.midThreshold,
          longRateCents: DAY_PASS_PRICING.longRateCents,
        },
      },
    }),
  );
});

/**
 * Begin a subscription checkout. Blocked when the user already holds a
 * Lifetime pass (mutual exclusion — Lifetime is the terminal entitlement).
 */
router.post("/subscriptions/checkout", async (req, res): Promise<void> => {
  const parsed = CreateSubscriptionCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to subscribe" });
    return;
  }
  if (!cardPaymentsEnabled()) {
    res.json(
      CreateSubscriptionCheckoutResponse.parse({
        success: false,
        message: CARD_PAYMENTS_OFF_MESSAGE,
      }),
    );
    return;
  }
  if (await hasLifetimePass(user.id)) {
    res.json(
      CreateSubscriptionCheckoutResponse.parse({
        success: false,
        message: "You already have Lifetime access — no subscription needed.",
      }),
    );
    return;
  }
  const result = await paymentProvider.createSubscriptionCheckout({
    userId: user.id,
    interval: parsed.data.interval,
  });
  res.json(CreateSubscriptionCheckoutResponse.parse(result));
});

/** Verify a subscription checkout token and activate it on success. */
router.post("/subscriptions/verify", async (req, res): Promise<void> => {
  const parsed = VerifySubscriptionCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to verify a subscription" });
    return;
  }
  if (!cardPaymentsEnabled()) {
    res.json(
      VerifySubscriptionCheckoutResponse.parse({
        success: false,
        message: CARD_PAYMENTS_OFF_MESSAGE,
      }),
    );
    return;
  }
  if (await hasLifetimePass(user.id)) {
    res.json(
      VerifySubscriptionCheckoutResponse.parse({
        success: false,
        message: "You already have Lifetime access — no subscription needed.",
      }),
    );
    return;
  }
  const verify = await paymentProvider.verifyAndActivateSubscription(
    parsed.data.opaqueToken,
    user.id,
  );
  if (!verify.success || !verify.interval || !verify.providerSubscriptionId) {
    res.json(
      VerifySubscriptionCheckoutResponse.parse({
        success: false,
        message: verify.message,
      }),
    );
    return;
  }
  // Idempotent upsert keyed on the Stripe subscription id — the webhook's
  // customer.subscription.created may have already inserted this row.
  const row = await db.transaction((tx) =>
    upsertPurchasedSubscriptionTx(tx, {
      userId: user.id,
      interval: verify.interval!,
      providerSubscriptionId: verify.providerSubscriptionId!,
      status: "active",
      currentPeriodEnd: verify.currentPeriodEnd,
      cancelAtPeriodEnd: false,
      provider: verify.provider,
      providerCustomerId: verify.providerCustomerId,
    }),
  );
  req.log.info(
    { userId: user.id, interval: row.interval },
    "Subscription verified",
  );
  res.json(
    VerifySubscriptionCheckoutResponse.parse({
      success: true,
      message: verify.message,
      subscription: {
        status: row.status,
        interval: row.interval,
        currentPeriodEnd: row.currentPeriodEnd,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      },
    }),
  );
});

/**
 * Cancel the caller's subscription. Routes through the provider seam, which
 * tells Stripe to stop renewing (cancel_at_period_end). On success we flag the
 * local row to match — access is retained until period end.
 */
router.post("/subscriptions/cancel", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage your subscription" });
    return;
  }
  const active = await getActiveSubscription(user.id);
  if (!active) {
    res.json(
      CancelSubscriptionResponse.parse({
        success: false,
        message: "You don't have an active subscription.",
      }),
    );
    return;
  }
  const result = await paymentProvider.cancelSubscription({ userId: user.id });
  if (!result.success) {
    res.json(
      CancelSubscriptionResponse.parse({
        success: false,
        message: result.message,
      }),
    );
    return;
  }
  await db.transaction((tx) => cancelSubscriptionTx(tx, user.id));
  req.log.info({ userId: user.id }, "Subscription set to cancel at period end");
  res.json(
    CancelSubscriptionResponse.parse({
      success: true,
      message: result.message,
      subscription: {
        status: active.status,
        interval: active.interval,
        currentPeriodEnd: active.currentPeriodEnd,
        cancelAtPeriodEnd: true,
      },
    }),
  );
});

export default router;
