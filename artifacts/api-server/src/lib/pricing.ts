import type { PassKind, SubscriptionInterval } from "@workspace/db";

/**
 * Single source of truth for all prices and plan metadata. The client reads
 * the plan catalog from /passes/plans rather than hardcoding amounts, so this
 * file is the only place to change pricing.
 *
 * Pricing ladder:
 *   - Day      $1.99  one-time pass (impulse unlock)
 *   - Monthly  $4.99/mo subscription (low-commitment on-ramp)
 *   - Yearly   $24.99/yr subscription ("best value" — ~58% off monthly)
 *   - Lifetime $49.99 one-time pass (premium anchor = 2 years of Yearly)
 */

/** Prices for one-time passes. `year` is retained only so any legacy Year
 * pass rows still resolve a price; the product issues no new Year passes
 * (the only "Yearly" is now the subscription). */
export const PASS_PRICES_CENTS: Record<PassKind, number> = {
  day: 199,
  year: 1299,
  lifetime: 4999,
};

/** Prices for recurring subscriptions, by billing interval. */
export const SUBSCRIPTION_PRICES_CENTS: Record<SubscriptionInterval, number> = {
  month: 499,
  year: 2499,
};

export type PlanId = "day" | "monthly" | "yearly" | "lifetime";

export interface Plan {
  id: PlanId;
  name: string;
  priceCents: number;
  description: string;
  /** "pass" = one-time purchase; "subscription" = recurring. */
  kind: "pass" | "subscription";
  /** Present for one-time passes — the pass kind to issue. */
  passKind?: PassKind;
  /** Present for subscriptions — the billing interval. */
  interval?: SubscriptionInterval;
}

/**
 * The user-facing plan catalog, in display order. There is intentionally no
 * one-time Year option — the only "Yearly" is the subscription.
 */
export const PLANS: Plan[] = [
  {
    id: "day",
    name: "Day Pass",
    priceCents: PASS_PRICES_CENTS.day,
    description: "Unlocks unlimited play & full history for 24 hours.",
    kind: "pass",
    passKind: "day",
  },
  {
    id: "monthly",
    name: "Monthly",
    priceCents: SUBSCRIPTION_PRICES_CENTS.month,
    description: "Full access, billed monthly. Renews automatically — cancel anytime.",
    kind: "subscription",
    interval: "month",
  },
  {
    id: "yearly",
    name: "Yearly",
    priceCents: SUBSCRIPTION_PRICES_CENTS.year,
    description: "Best value — full access billed yearly. Renews automatically — cancel anytime.",
    kind: "subscription",
    interval: "year",
  },
  {
    id: "lifetime",
    name: "Lifetime",
    priceCents: PASS_PRICES_CENTS.lifetime,
    description: "Pay once, play forever. Includes custom screen names.",
    kind: "pass",
    passKind: "lifetime",
  },
];
