import type { PassKind, SubscriptionInterval } from "@workspace/db";
import {
  LUCKY_BREAK_CODE_KIND,
  LUCKY_BREAK_WINDOW_DAYS,
} from "./luckyBreak";
import { luckyBreakLifetimeProbability } from "./config";

/**
 * Single source of truth for all prices and plan metadata. The client reads
 * the plan catalog from /passes/plans rather than hardcoding amounts, so this
 * file is the only place to change pricing.
 *
 * Pricing ladder:
 *   - Day      $1.99  one-time pass (impulse unlock)
 *   - Monthly  $4.99/mo subscription (low-commitment on-ramp)
 *   - Yearly   $14.99/yr subscription ("best value" — ~75% off monthly)
 *   - Lifetime $24.99 one-time pass (premium anchor)
 */

/** Prices for one-time passes. The one-time `year` pass is sold via crypto
 * checkout, priced to match the Yearly subscription; legacy Year pass rows
 * resolve their own stored price. */
export const PASS_PRICES_CENTS: Record<PassKind, number> = {
  day: 199,
  // 14-day card pass sold off-platform via Squarespace + admin redeem code.
  // Deliberately worse value than the $4.99 / 30-day crypto Month pass to nudge
  // buyers toward crypto. Not crypto-buyable — absent from CRYPTO_PASS_PLANS.
  twoweek: 599,
  month: 499,
  year: 1499,
  lifetime: 2499,
};

/**
 * Lucky Break — a single $4.99 "roll the rack" unlock sold via redeem codes
 * (no in-app card checkout). Every roll grants at least a Monthly pass; a
 * fixed, disclosed share of rolls upgrade to Lifetime. The odds and entropy
 * recipe live in the pure engine (`luckyBreak.ts`); the price lives here with
 * the rest of the catalog so there is a single source of truth.
 */
export const LUCKY_BREAK_PRICE_CENTS = 499;

/** Public Lucky Break catalog entry surfaced via /passes/plans. Mirrors the
 * disclosed odds + entropy window so the client shows the exact same numbers
 * the server rolls against. Built per-request (not a module-load constant) so
 * the env-tunable `lifetimeProbability` is always current — the disclosed odds
 * can never drift from the odds the draw actually uses. */
export function luckyBreakInfo() {
  return {
    priceCents: LUCKY_BREAK_PRICE_CENTS,
    lifetimeProbability: luckyBreakLifetimeProbability(),
    windowDays: LUCKY_BREAK_WINDOW_DAYS,
  } as const;
}

/** Prices for recurring subscriptions, by billing interval. */
export const SUBSCRIPTION_PRICES_CENTS: Record<SubscriptionInterval, number> = {
  month: 499,
  year: 1499,
};

/**
 * One-time passes purchasable with crypto (USDC / native ETH on Base). Crypto
 * sells time-based passes only — there are no crypto subscriptions — so unlike
 * the card catalog (where "Monthly"/"Yearly" are recurring), here Month and
 * Year are one-time, fixed-duration passes that do not auto-renew. Prices reuse
 * the single PASS_PRICES_CENTS source.
 */
/**
 * What a crypto checkout can buy. Either a fixed one-time pass kind, or the
 * "lucky_break" sentinel — paid at the Lucky Break price, it runs the seeded
 * draw on confirmation and grants the won tier (Monthly floor, fixed-odds
 * Lifetime) instead of a predetermined pass.
 */
export type CryptoItemKind =
  | Extract<PassKind, "day" | "month" | "year" | "lifetime">
  | typeof LUCKY_BREAK_CODE_KIND;

export interface CryptoPassPlan {
  passKind: CryptoItemKind;
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
    passKind: LUCKY_BREAK_CODE_KIND,
    name: "Lucky Break",
    priceCents: LUCKY_BREAK_PRICE_CENTS,
    description:
      "Roll the rack — a guaranteed Monthly pass with a fixed chance at Lifetime.",
  },
  {
    passKind: "year",
    name: "Year Pass",
    priceCents: PASS_PRICES_CENTS.year,
    description: "Full access for 365 days. One-time — does not auto-renew.",
  },
  {
    passKind: "lifetime",
    name: "Lifetime",
    priceCents: PASS_PRICES_CENTS.lifetime,
    description: "Pay once, play forever. Includes custom screen names.",
  },
];

/**
 * User-bought HUD ad pricing. The displayed/charged daily rate is dynamic:
 *
 *   multiplier        = activeAdsCount / 100 + gamesLast24h / 3
 *   effectiveDaily¢   = max(minDailyCents, round(baseDailyCents × multiplier))
 *   total¢            = effectiveDaily¢ × days
 *
 * `effectiveDaily¢` is rounded to an integer first so the client (which only
 * receives `effectiveDailyCents` from /ads/pricing and multiplies by `days`)
 * and the server (which freezes the same product at quote time) always agree to
 * the cent. The defaults below are the out-of-the-box knobs; all three are
 * env-overridable via config.ts.
 */
export const AD_BASE_DAILY_CENTS_DEFAULT = 690;
export const AD_MIN_DAILY_CENTS_DEFAULT = 100;
export const AD_MAX_DAYS_DEFAULT = 369;

export interface AdQuoteInput {
  days: number;
  activeAdsCount: number;
  gamesLast24h: number;
  baseDailyCents: number;
  minDailyCents: number;
}

export interface AdQuote {
  days: number;
  /** Per-day rate in cents, after the multiplier + floor (integer). */
  effectiveDailyCents: number;
  /** Frozen total in cents: effectiveDailyCents × days. */
  totalCents: number;
  /** The raw demand multiplier (for diagnostics / logging). */
  multiplier: number;
}

/** Pure ad-price computation (see the block comment above). */
export function computeAdQuote(input: AdQuoteInput): AdQuote {
  const multiplier =
    input.activeAdsCount / 100 + input.gamesLast24h / 3;
  const effectiveDailyCents = Math.max(
    input.minDailyCents,
    Math.round(input.baseDailyCents * multiplier),
  );
  return {
    days: input.days,
    effectiveDailyCents,
    totalCents: effectiveDailyCents * input.days,
    multiplier,
  };
}

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
