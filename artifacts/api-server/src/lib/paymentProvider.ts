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
 * Prices live in pricing.ts (single source of truth), not here.
 */

import type { SubscriptionInterval } from "@workspace/db";

// TODO(remove-before-launch): dev/QA-only flag that exposes the free Lifetime
// upgrade button on the Account screen, the dev subscription activator, and the
// matching POST routes. Gated to non-production so a deploy can never hand out
// free Lifetime/subscriptions and bypass payment (the dev workflow runs with
// NODE_ENV=development). Rip out together with the routes + AccountScreen
// affordances before going live.
export const DEV_FREE_UPGRADE_ENABLED = process.env.NODE_ENV !== "production";

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

/**
 * No-op payment provider. Every method REJECTS — there's no real billing
 * wired up, so the only paths to entitlement right now are discount codes or
 * an admin/dev grant. Swap this out before going live with paid plans. The
 * cancel path is fully shaped (interface + route + UI) but also rejects, so a
 * real provider drops in cleanly.
 */
export class NoopPaymentProvider implements PaymentProvider {
  async createCheckout(): Promise<CreateCheckoutResult> {
    return {
      success: false,
      message:
        "Card payments aren't configured yet. Use a discount code, or check back soon.",
    };
  }
  async verifyAndGrant(): Promise<VerifyAndGrantResult> {
    return {
      success: false,
      message: "Payments aren't configured yet. Nothing to verify.",
    };
  }
  async createSubscriptionCheckout(): Promise<CreateCheckoutResult> {
    return {
      success: false,
      message:
        "Subscriptions aren't configured yet. Card billing is coming soon.",
    };
  }
  async verifyAndActivateSubscription(): Promise<VerifyAndActivateSubscriptionResult> {
    return {
      success: false,
      message: "Subscriptions aren't configured yet. Nothing to verify.",
    };
  }
  async cancelSubscription(): Promise<CancelSubscriptionResult> {
    return {
      success: false,
      message: "Subscription management isn't available yet. Check back soon.",
    };
  }
}

export const paymentProvider: PaymentProvider = new NoopPaymentProvider();
