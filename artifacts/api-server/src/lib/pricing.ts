import type { PassKind, SubscriptionInterval } from "@workspace/db";
import {
  LUCKY_BREAK_LIFETIME_PROBABILITY,
  LUCKY_BREAK_WINDOW_DAYS,
} from "./luckyBreak";

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
  month: 499,
  year: 1299,
  lifetime: 4999,
};

/**
 * Lucky Break — a single $5.99 "roll the rack" unlock sold via redeem codes
 * (no in-app card checkout). Every roll grants at least a Monthly pass; a
 * fixed, disclosed share of rolls upgrade to Lifetime. The odds and entropy
 * recipe live in the pure engine (`luckyBreak.ts`); the price lives here with
 * the rest of the catalog so there is a single source of truth.
 */
export const LUCKY_BREAK_PRICE_CENTS = 599;

/** Public Lucky Break catalog entry surfaced via /passes/plans. Mirrors the
 * disclosed odds + entropy window from the pure engine so the client shows the
 * exact same numbers the server rolls against. */
export const LUCKY_BREAK_INFO = {
  priceCents: LUCKY_BREAK_PRICE_CENTS,
  lifetimeProbability: LUCKY_BREAK_LIFETIME_PROBABILITY,
  windowDays: LUCKY_BREAK_WINDOW_DAYS,
} as const;

/** Prices for recurring subscriptions, by billing interval. */
export const SUBSCRIPTION_PRICES_CENTS: Record<SubscriptionInterval, number> = {
  month: 499,
  year: 2499,
};

/**
 * One-time passes purchasable with crypto (USDC / native ETH on Base). Crypto
 * sells time-based passes only — there are no crypto subscriptions — so unlike
 * the card catalog (where "Monthly"/"Yearly" are recurring), here Month is a
 * one-time 30-day pass. Prices reuse the single PASS_PRICES_CENTS source.
 */
export interface CryptoPassPlan {
  passKind: Extract<PassKind, "day" | "month" | "lifetime">;
  name: string;
  priceCents: number;
  description: string;
}

export const CRYPTO_PASS_PLANS: CryptoPassPlan[] = [
  {
    passKind: "day",
    name: "Day Pass",
    priceCents: PASS_PRICES_CENTS.day,
    description: "Unlocks unlimited play & full history for 24 hours.",
  },
  {
    passKind: "month",
    name: "Month Pass",
    priceCents: PASS_PRICES_CENTS.month,
    description: "Full access for 30 days. One-time — does not auto-renew.",
  },
  {
    passKind: "lifetime",
    name: "Lifetime",
    priceCents: PASS_PRICES_CENTS.lifetime,
    description: "Pay once, play forever. Includes custom screen names.",
  },
];

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
