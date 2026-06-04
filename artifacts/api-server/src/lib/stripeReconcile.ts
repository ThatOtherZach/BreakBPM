/**
 * Webhook → entitlement reconciliation. The Stripe webhook is the
 * authoritative source for granting access: StripeSync keeps the `stripe`
 * schema mirrored, and this module translates the verified events into our own
 * `passes` / `subscriptions` rows (the source of truth for ACCESS).
 *
 * Every handler is idempotent — Stripe delivers at-least-once and our verify
 * endpoint may have already granted the same purchase — so we dedup on the
 * Stripe payment-intent id (passes) and subscription id (subscriptions).
 */

import type Stripe from "stripe";
import { db, subscriptionsTable, type PassKind } from "@workspace/db";
import { eq } from "drizzle-orm";
import { grantPurchasedPassTx } from "./passes";
import { upsertPurchasedSubscriptionTx } from "./subscriptions";
import {
  readSubscriptionInterval,
  readSubscriptionPeriodEnd,
  mapSubscriptionStatus,
} from "./stripeMapping";
import { logger } from "./logger";

export async function reconcileStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // Subscriptions are reconciled off customer.subscription.* events; here
      // we only handle one-time pass purchases.
      if (session.mode === "payment" && session.payment_status === "paid") {
        await grantPassFromSession(session);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      await reconcileSubscription(
        event.data.object as Stripe.Subscription,
        false,
      );
      break;
    }
    case "customer.subscription.deleted": {
      await reconcileSubscription(
        event.data.object as Stripe.Subscription,
        true,
      );
      break;
    }
    default:
      break;
  }
}

async function grantPassFromSession(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const userId = session.metadata?.userId;
  const passKind = session.metadata?.passKind as PassKind | undefined;
  if (!userId || (passKind !== "day" && passKind !== "lifetime")) {
    logger.warn(
      { sessionId: session.id },
      "checkout.session.completed missing userId/passKind metadata; skipping",
    );
    return;
  }
  const sourceRef =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.id;

  const { deduped } = await db.transaction((tx) =>
    grantPurchasedPassTx(tx, { userId, kind: passKind, sourceRef }),
  );
  logger.info(
    { userId, passKind, sourceRef, deduped },
    "Reconciled pass purchase from webhook",
  );
}

async function reconcileSubscription(
  sub: Stripe.Subscription,
  deleted: boolean,
): Promise<void> {
  const userId = await resolveUserId(sub);
  if (!userId) {
    logger.warn(
      { subscriptionId: sub.id },
      "Could not resolve userId for subscription event; skipping",
    );
    return;
  }
  const interval = readSubscriptionInterval(sub);
  if (!interval) {
    logger.warn(
      { subscriptionId: sub.id },
      "Could not determine interval for subscription event; skipping",
    );
    return;
  }

  const status = deleted ? "canceled" : mapSubscriptionStatus(sub.status);
  const cancelAtPeriodEnd = deleted ? true : !!sub.cancel_at_period_end;
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

  await db.transaction((tx) =>
    upsertPurchasedSubscriptionTx(tx, {
      userId,
      interval,
      status,
      currentPeriodEnd: readSubscriptionPeriodEnd(sub),
      cancelAtPeriodEnd,
      provider: "stripe",
      providerCustomerId: customerId ?? null,
      providerSubscriptionId: sub.id,
    }),
  );
  logger.info(
    { userId, subscriptionId: sub.id, status, cancelAtPeriodEnd },
    "Reconciled subscription from webhook",
  );
}

async function resolveUserId(
  sub: Stripe.Subscription,
): Promise<string | null> {
  const metaUser = sub.metadata?.userId;
  if (metaUser) return metaUser;
  const [row] = await db
    .select({ userId: subscriptionsTable.userId })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.providerSubscriptionId, sub.id))
    .limit(1);
  return row?.userId ?? null;
}
