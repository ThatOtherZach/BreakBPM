import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  ListPlansResponse,
  CreateSubscriptionCheckoutBody,
  CreateSubscriptionCheckoutResponse,
  VerifySubscriptionCheckoutBody,
  VerifySubscriptionCheckoutResponse,
  CancelSubscriptionResponse,
  DevActivateSubscriptionBody,
  DevActivateSubscriptionResponse,
} from "@workspace/api-zod";
import { getOrCreateUser } from "../lib/auth";
import { getActivePasses, getActiveSubscription } from "../lib/entitlement";
import {
  activateSubscriptionTx,
  cancelSubscriptionTx,
} from "../lib/subscriptions";
import { paymentProvider, DEV_FREE_UPGRADE_ENABLED } from "../lib/paymentProvider";
import { PLANS } from "../lib/pricing";

const router: IRouter = Router();

async function hasLifetimePass(userId: string): Promise<boolean> {
  const passes = await getActivePasses(userId);
  return passes.some((p) => p.isLifetime);
}

/** Public plan catalog — single source of truth for prices/metadata. */
router.get("/passes/plans", async (_req, res): Promise<void> => {
  res.json(ListPlansResponse.parse({ plans: PLANS }));
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
  );
  if (!verify.success || !verify.interval) {
    res.json(
      VerifySubscriptionCheckoutResponse.parse({
        success: false,
        message: verify.message,
      }),
    );
    return;
  }
  const row = await db.transaction((tx) =>
    activateSubscriptionTx(tx, {
      userId: user.id,
      interval: verify.interval!,
      source: "purchase",
      currentPeriodEnd: verify.currentPeriodEnd,
      provider: verify.provider,
      providerCustomerId: verify.providerCustomerId,
      providerSubscriptionId: verify.providerSubscriptionId,
    }),
  );
  req.log.info(
    { userId: user.id, interval: row.interval },
    "Subscription activated",
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
 * Cancel the caller's subscription. Routes through the provider seam (which
 * rejects until a real provider is wired). When a provider confirms, we flag
 * the local row to stop renewing — access is retained until period end.
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

// TODO(remove-before-launch): dev-only subscription activator. Returns 404
// when DEV_FREE_UPGRADE_ENABLED is false. Lets QA simulate an active
// subscription without a real billing provider. Rip out with the flag.
router.post("/subscriptions/dev-activate", async (req, res): Promise<void> => {
  if (!DEV_FREE_UPGRADE_ENABLED) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = DevActivateSubscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in first" });
    return;
  }
  if (await hasLifetimePass(user.id)) {
    res.json(
      DevActivateSubscriptionResponse.parse({
        success: false,
        message: "You already have Lifetime access — no subscription needed.",
      }),
    );
    return;
  }
  const row = await db.transaction(async (tx) => {
    // Serialize concurrent dev-activations per user so double-clicks can't
    // create two subscription rows.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`);
    const existing = await getActiveSubscription(user.id);
    if (existing) return null;
    return activateSubscriptionTx(tx, {
      userId: user.id,
      interval: parsed.data.interval,
      source: "grant",
      provider: "dev",
    });
  });
  if (!row) {
    const existing = await getActiveSubscription(user.id);
    res.json(
      DevActivateSubscriptionResponse.parse({
        success: true,
        message: "You already have an active subscription.",
        subscription: existing ?? undefined,
      }),
    );
    return;
  }
  req.log.warn(
    { userId: user.id, interval: row.interval },
    "DEV: free subscription activated via /subscriptions/dev-activate",
  );
  res.json(
    DevActivateSubscriptionResponse.parse({
      success: true,
      message: "Subscription activated. Enjoy!",
      subscription: {
        status: row.status,
        interval: row.interval,
        currentPeriodEnd: row.currentPeriodEnd,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      },
    }),
  );
});

export default router;
