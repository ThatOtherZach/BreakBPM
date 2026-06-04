/**
 * Payment provider seam. The route handlers know nothing about Stripe /
 * PayPal / etc — they just round-trip opaque tokens. Swap the singleton at
 * the bottom to plug in a real provider. Discount codes do NOT go through
 * this seam — they're handled directly in /passes/redeem.
 *
 * Two product shapes share this seam:
 *   - One-time passes (Day, Lifetime): createCheckout → verifyAndGrant.
 *   - Recurring subscriptions (Monthly, Yearly): createSubscriptionCheckout →
 *     verifyAndActivateSubscription, plus cancelSubscription to stop renewal.
 *
 * Prices live in pricing.ts (single source of truth), not here. The Stripe
 * Price objects must be kept consistent with that catalog — see the
 * seed-stripe-products.ts script, which tags each Price with metadata.planId
 * so we can resolve the right Price at checkout time.
 */

import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, usersTable, type SubscriptionInterval } from "@workspace/db";
import { getUncachableStripeClient } from "./stripeClient";
import { PLANS, type PlanId } from "./pricing";
import { getActiveProviderSubscriptionId } from "./subscriptions";
import {
  readSubscriptionInterval,
  readSubscriptionPeriodEnd,
} from "./stripeMapping";
import { logger } from "./logger";

export type PassKind = "day" | "year" | "lifetime";

export interface CreateCheckoutInput {
  userId: string;
  kind: PassKind;
}

export interface CreateCheckoutResult {
  success: boolean;
  message: string;
  /** Opaque, provider-issued token. Hand back to verifyAndGrant. */
  opaqueToken?: string;
  /** Where the user should be sent (Stripe / PayPal redirect, etc). */
  checkoutUrl?: string;
}

export interface VerifyAndGrantResult {
  success: boolean;
  message: string;
  /** Provider-confirmed pass kind — authoritative, NOT taken from client. */
  kind?: PassKind;
  /** Provider-side reference (e.g. Stripe payment intent id). */
  providerRef?: string;
}

export interface CreateSubscriptionCheckoutInput {
  userId: string;
  interval: SubscriptionInterval;
}

export interface VerifyAndActivateSubscriptionResult {
  success: boolean;
  message: string;
  /** Provider-confirmed interval — authoritative, NOT taken from client. */
  interval?: SubscriptionInterval;
  /** Paid-through date the provider reports for the first period. */
  currentPeriodEnd?: Date;
  provider?: string;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
}

export interface CancelSubscriptionInput {
  userId: string;
  /** Provider-side subscription id to cancel, when known. */
  providerSubscriptionId?: string | null;
}

export interface CancelSubscriptionResult {
  success: boolean;
  message: string;
  /** True once the provider confirms the subscription will not renew. */
  cancelAtPeriodEnd?: boolean;
  /** Paid-through date — the user keeps access until this date. */
  currentPeriodEnd?: Date;
}

export interface PaymentProvider {
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  verifyAndGrant(opaqueToken: string): Promise<VerifyAndGrantResult>;
  createSubscriptionCheckout(
    input: CreateSubscriptionCheckoutInput,
  ): Promise<CreateCheckoutResult>;
  verifyAndActivateSubscription(
    opaqueToken: string,
  ): Promise<VerifyAndActivateSubscriptionResult>;
  cancelSubscription(
    input: CancelSubscriptionInput,
  ): Promise<CancelSubscriptionResult>;
}

const NOT_CONFIGURED_MSG =
  "Card payments aren't configured yet. Use a discount code, or check back soon.";

/**
 * True when an error is "Stripe isn't connected yet" rather than a genuine
 * billing failure — used to show the friendly not-configured message.
 */
function isNotConnected(err: unknown): boolean {
  const m = err instanceof Error ? err.message : "";
  return (
    m.includes("integration") ||
    m.includes("connected") ||
    m.includes("Replit environment") ||
    m.includes("secret key") ||
    m.includes("credentials")
  );
}

function appOrigin(): string {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (!domain) {
    throw new Error("REPLIT_DOMAINS not set — cannot build checkout return URL");
  }
  return `https://${domain}`;
}

async function getUserEmail(userId: string): Promise<string | null> {
  const [u] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.email ?? null;
}

/**
 * Resolve the live Stripe Price id for a plan via its metadata.planId tag.
 * Returns null when no matching active price exists (products not seeded yet).
 */
async function resolvePriceId(
  stripe: Stripe,
  planId: PlanId,
): Promise<string | null> {
  const prices = await stripe.prices.list({ active: true, limit: 100 });
  const match = prices.data.find((p) => p.metadata?.planId === planId);
  return match?.id ?? null;
}

export class StripePaymentProvider implements PaymentProvider {
  async createCheckout(
    input: CreateCheckoutInput,
  ): Promise<CreateCheckoutResult> {
    try {
      const plan = PLANS.find(
        (p) => p.kind === "pass" && p.passKind === input.kind,
      );
      if (!plan) {
        return { success: false, message: "That plan isn't available." };
      }

      const stripe = await getUncachableStripeClient();
      const priceId = await resolvePriceId(stripe, plan.id);
      if (!priceId) {
        return {
          success: false,
          message:
            "Plans aren't set up in Stripe yet. Please check back shortly.",
        };
      }

      const email = await getUserEmail(input.userId);
      const origin = appOrigin();
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: input.userId,
        metadata: {
          userId: input.userId,
          planId: plan.id,
          kind: "pass",
          passKind: input.kind,
        },
        payment_intent_data: {
          metadata: {
            userId: input.userId,
            planId: plan.id,
            passKind: input.kind,
          },
        },
        ...(email ? { customer_email: email } : {}),
        success_url: `${origin}/passes?status=success&type=pass&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/passes?status=cancel`,
      });

      if (!session.url) {
        return {
          success: false,
          message: "Couldn't start checkout. Please try again.",
        };
      }
      return {
        success: true,
        message: "Redirecting to secure checkout…",
        opaqueToken: session.id,
        checkoutUrl: session.url,
      };
    } catch (err) {
      logger.error({ err }, "Stripe createCheckout failed");
      return {
        success: false,
        message: isNotConnected(err)
          ? NOT_CONFIGURED_MSG
          : "Couldn't start checkout. Please try again.",
      };
    }
  }

  async verifyAndGrant(opaqueToken: string): Promise<VerifyAndGrantResult> {
    try {
      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(opaqueToken);
      if (session.mode !== "payment") {
        return { success: false, message: "That checkout isn't a pass purchase." };
      }
      if (session.payment_status !== "paid") {
        return { success: false, message: "Payment hasn't completed yet." };
      }
      const kind = session.metadata?.passKind as PassKind | undefined;
      if (kind !== "day" && kind !== "lifetime") {
        return {
          success: false,
          message: "Couldn't determine what was purchased.",
        };
      }
      const providerRef =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.id;
      return {
        success: true,
        message: `Your ${kind === "lifetime" ? "Lifetime" : "Day"} pass is active!`,
        kind,
        providerRef,
      };
    } catch (err) {
      logger.error({ err }, "Stripe verifyAndGrant failed");
      return {
        success: false,
        message: isNotConnected(err)
          ? "Payments aren't configured yet. Nothing to verify."
          : "We couldn't verify your payment. If you were charged, it'll activate shortly.",
      };
    }
  }

  async createSubscriptionCheckout(
    input: CreateSubscriptionCheckoutInput,
  ): Promise<CreateCheckoutResult> {
    try {
      const plan = PLANS.find(
        (p) => p.kind === "subscription" && p.interval === input.interval,
      );
      if (!plan) {
        return { success: false, message: "That plan isn't available." };
      }

      const stripe = await getUncachableStripeClient();
      const priceId = await resolvePriceId(stripe, plan.id);
      if (!priceId) {
        return {
          success: false,
          message:
            "Plans aren't set up in Stripe yet. Please check back shortly.",
        };
      }

      const email = await getUserEmail(input.userId);
      const origin = appOrigin();
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: input.userId,
        metadata: {
          userId: input.userId,
          planId: plan.id,
          kind: "subscription",
          interval: input.interval,
        },
        subscription_data: {
          metadata: {
            userId: input.userId,
            planId: plan.id,
            interval: input.interval,
          },
        },
        ...(email ? { customer_email: email } : {}),
        success_url: `${origin}/passes?status=success&type=sub&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/passes?status=cancel`,
      });

      if (!session.url) {
        return {
          success: false,
          message: "Couldn't start checkout. Please try again.",
        };
      }
      return {
        success: true,
        message: "Redirecting to secure checkout…",
        opaqueToken: session.id,
        checkoutUrl: session.url,
      };
    } catch (err) {
      logger.error({ err }, "Stripe createSubscriptionCheckout failed");
      return {
        success: false,
        message: isNotConnected(err)
          ? NOT_CONFIGURED_MSG
          : "Couldn't start checkout. Please try again.",
      };
    }
  }

  async verifyAndActivateSubscription(
    opaqueToken: string,
  ): Promise<VerifyAndActivateSubscriptionResult> {
    try {
      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(opaqueToken, {
        expand: ["subscription"],
      });
      if (session.mode !== "subscription") {
        return {
          success: false,
          message: "That checkout isn't a subscription.",
        };
      }
      if (session.status !== "complete") {
        return {
          success: false,
          message: "Subscription checkout hasn't completed yet.",
        };
      }
      const sub = session.subscription;
      if (!sub || typeof sub === "string") {
        return {
          success: false,
          message: "Subscription isn't ready yet. Please refresh in a moment.",
        };
      }
      const interval = readSubscriptionInterval(sub);
      if (!interval) {
        return {
          success: false,
          message: "Couldn't determine the subscription plan.",
        };
      }
      const customerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
      return {
        success: true,
        message: `Your ${interval === "year" ? "Yearly" : "Monthly"} subscription is active!`,
        interval,
        currentPeriodEnd: readSubscriptionPeriodEnd(sub),
        provider: "stripe",
        providerCustomerId: customerId ?? undefined,
        providerSubscriptionId: sub.id,
      };
    } catch (err) {
      logger.error({ err }, "Stripe verifyAndActivateSubscription failed");
      return {
        success: false,
        message: isNotConnected(err)
          ? "Subscriptions aren't configured yet. Nothing to verify."
          : "We couldn't verify your subscription. If you were charged, it'll activate shortly.",
      };
    }
  }

  async cancelSubscription(
    input: CancelSubscriptionInput,
  ): Promise<CancelSubscriptionResult> {
    try {
      const subId =
        input.providerSubscriptionId ??
        (await getActiveProviderSubscriptionId(input.userId));
      if (!subId) {
        return {
          success: false,
          message: "No active subscription to cancel.",
        };
      }

      const stripe = await getUncachableStripeClient();
      const updated = await stripe.subscriptions.update(subId, {
        cancel_at_period_end: true,
      });
      return {
        success: true,
        message:
          "Your subscription will not renew. You keep full access until the end of the paid period.",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: readSubscriptionPeriodEnd(updated),
      };
    } catch (err) {
      logger.error({ err }, "Stripe cancelSubscription failed");
      return {
        success: false,
        message: isNotConnected(err)
          ? "Subscription management isn't available yet. Check back soon."
          : "Couldn't cancel your subscription. Please try again.",
      };
    }
  }
}

export const paymentProvider: PaymentProvider = new StripePaymentProvider();
