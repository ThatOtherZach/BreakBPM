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
  // 30-day card pass sold off-platform via Squarespace + admin redeem code
  // (internal kind name "twoweek" predates this — see passes.ts). Deliberately
  // worse value than buying the same 30 days via the flexible crypto day pass
  // (~$4.89 at default DAY_PASS_PRICING) to nudge buyers toward crypto. Not
  // crypto-buyable — absent from CRYPTO_PASS_PLANS.
  twoweek: 499,
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
 * Flexible crypto "add days" pass — marginal-bracket pricing. The buyer picks
 * any 1–365 days on a slider and pays a total built from three brackets:
 *
 *   - the first day is a flat fee (impulse-unlock anchor, = the Day pass price);
 *   - each subsequent day up to `midThreshold` (30) adds `midRateCents`;
 *   - each day beyond `midThreshold` adds the cheaper `longRateCents`.
 *
 * So the per-day rate falls the more you buy. The params are shipped to the
 * client via the /passes/plans crypto catalog so it can render a live price
 * estimate from the EXACT same math; the server recomputes + freezes the
 * authoritative amount at quote time (the client never sets the price).
 *
 * Sample totals: 1d→$1.99, 7d→$2.59, 30d→$4.89, 31d→$4.92, 365d→$14.94.
 */
export interface DayPassPricingParams {
  minDays: number;
  maxDays: number;
  firstDayCents: number;
  midRateCents: number;
  midThreshold: number;
  longRateCents: number;
}

export const DAY_PASS_PRICING: DayPassPricingParams = {
  minDays: 1,
  maxDays: 365,
  firstDayCents: PASS_PRICES_CENTS.day,
  midRateCents: 10,
  midThreshold: 30,
  longRateCents: 3,
};

/** Pure marginal-bracket price for an N-day crypto pass (see DAY_PASS_PRICING).
 * Days are clamped to [minDays, maxDays] and floored to an integer so the
 * client estimate and the server-frozen quote always agree to the cent. */
export function computeDayPassPriceCents(
  days: number,
  params: DayPassPricingParams = DAY_PASS_PRICING,
): number {
  const d = Math.min(
    params.maxDays,
    Math.max(params.minDays, Math.floor(days)),
  );
  let total = params.firstDayCents;
  if (d >= 2) {
    total += (Math.min(d, params.midThreshold) - 1) * params.midRateCents;
  }
  if (d > params.midThreshold) {
    total += (d - params.midThreshold) * params.longRateCents;
  }
  return total;
}

/**
 * Fixed-price items purchasable with crypto (USDC / native ETH on Base). Crypto
 * sells time-based passes only — there are no crypto subscriptions. The flexible
 * day pass (1–365 days, marginal-bracket priced — see DAY_PASS_PRICING) is NOT
 * listed here; it is quoted dynamically from the slider. This catalog carries
 * only the two FIXED-price crypto items: Lucky Break and Lifetime. (Legacy
 * `month`/`year` crypto orders still verify — their price/duration is resolved
 * from PASS_PRICES_CENTS/PASS_DURATIONS_SECONDS — but are no longer offered.)
 */
/**
 * What a crypto checkout can buy as a FIXED-price item. Either a fixed one-time
 * pass kind, or the "lucky_break" sentinel — paid at the Lucky Break price, it
 * runs the seeded draw on confirmation and grants the won tier (Monthly floor,
 * fixed-odds Lifetime) instead of a predetermined pass. The flexible "days"
 * pass is quoted dynamically and is intentionally absent from this type.
 */
export type CryptoItemKind =
  | Extract<PassKind, "lifetime">
  | typeof LUCKY_BREAK_CODE_KIND;

export interface CryptoPassPlan {
  passKind: CryptoItemKind;
  name: string;
  priceCents: number;
  description: string;
}

export const CRYPTO_PASS_PLANS: CryptoPassPlan[] = [
  {
    passKind: LUCKY_BREAK_CODE_KIND,
    name: "Lucky Break",
    priceCents: LUCKY_BREAK_PRICE_CENTS,
    description:
      "Roll the rack — a guaranteed Monthly pass with a fixed chance at Lifetime.",
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
