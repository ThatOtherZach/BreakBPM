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
import { desc, eq } from "drizzle-orm";
import { grantPurchasedPassTx } from "./passes";
import { stopRenewingStripeSubscriptions } from "./paymentProvider";
import { upsertPurchasedSubscriptionTx } from "./subscriptions";
import { PASS_PRICES_CENTS } from "./pricing";
import { recordSaleEventTx, PASS_PRODUCT_LABELS } from "./saleEvents";
import { getUsdToCadRate } from "./fx";
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
    case "invoice.payment_succeeded": {
      await recordInvoiceRenewal(event.data.object as Stripe.Invoice);
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

  // Freeze today's USD→CAD rate for the ledger BEFORE the tx (fx never throws).
  const fx = await getUsdToCadRate();
  const { deduped } = await db.transaction(async (tx) => {
    const grant = await grantPurchasedPassTx(tx, {
      userId,
      kind: passKind,
      sourceRef,
    });
    // Sales ledger: record the paid Stripe purchase once, in the same tx. The
    // amount is the catalog price for the kind; providerRef = payment-intent so
    // a racing verify/webhook can't double-record (unique on provider_ref).
    if (!grant.deduped) {
      await recordSaleEventTx(tx, {
        userId,
        eventType: "stripe_purchase",
        paymentMethod: "stripe",
        grossCents: PASS_PRICES_CENTS[passKind],
        isComp: false,
        productLabel: PASS_PRODUCT_LABELS[passKind],
        fx,
        providerRef: sourceRef,
      });
    }
    return grant;
  });
  logger.info(
    { userId, passKind, sourceRef, deduped },
    "Reconciled pass purchase from webhook",
  );
  // Authoritative path: a webhook-reconciled Lifetime must also stop the real
  // Stripe subscription from renewing (best-effort, outside the tx). Skipped on
  // dedup — verify or an earlier webhook already handled it.
  if (passKind === "lifetime" && !deduped) {
    await stopRenewingStripeSubscriptions(userId);
  }
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

/**
 * Record a recurring subscription RENEWAL as a sale. Stripe fires
 * `invoice.payment_succeeded` on every successful charge (the first one and
 * every renewal). We resolve the buyer + interval from our own mirror of the
 * subscription (keyed on the stable `invoice.customer`, which survives Stripe's
 * API-version churn on the invoice→subscription field), value the row at the
 * amount actually collected, and key it on the invoice id. `recordSaleEventTx`
 * is ON CONFLICT DO NOTHING, so at-least-once webhook redelivery is harmless.
 *
 * Dormant while card payments are flagged off, but ready the moment they flip.
 */
async function recordInvoiceRenewal(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.id) return;
  if (!invoice.amount_paid || invoice.amount_paid <= 0) return; // $0 invoice
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : (invoice.customer?.id ?? null);
  if (!customerId) {
    logger.warn(
      { invoiceId: invoice.id },
      "invoice.payment_succeeded without a customer; skipping sale record",
    );
    return;
  }
  const [sub] = await db
    .select({
      userId: subscriptionsTable.userId,
      interval: subscriptionsTable.interval,
    })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.providerCustomerId, customerId))
    .orderBy(desc(subscriptionsTable.updatedAt))
    .limit(1);
  if (!sub) {
    logger.warn(
      { invoiceId: invoice.id, customerId },
      "Could not resolve a subscription for invoice; skipping sale record",
    );
    return;
  }
  const productLabel =
    sub.interval === "year" ? "Yearly Subscription" : "Monthly Subscription";
  // Freeze today's USD→CAD rate for the ledger BEFORE the tx (fx never throws).
  const fx = await getUsdToCadRate();
  await db.transaction((tx) =>
    recordSaleEventTx(tx, {
      userId: sub.userId,
      eventType: "subscription_renewal",
      paymentMethod: "stripe",
      grossCents: invoice.amount_paid,
      isComp: false,
      productLabel,
      fx,
      providerRef: invoice.id as string,
      occurredAt: new Date((invoice.created ?? Date.now() / 1000) * 1000),
    }),
  );
  logger.info(
    { invoiceId: invoice.id, userId: sub.userId },
    "Recorded subscription renewal sale from webhook",
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
