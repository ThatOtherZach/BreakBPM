/**
 * Runtime feature flags read from the environment. Centralized so every
 * handler agrees on the same answer and the defaults are documented in one
 * place.
 */

import { logger } from "./logger";
import { LUCKY_BREAK_LIFETIME_PROBABILITY } from "./luckyBreak";
import {
  AD_BASE_DAILY_CENTS_DEFAULT,
  AD_MIN_DAILY_CENTS_DEFAULT,
  AD_MAX_DAYS_DEFAULT,
  DAY_PASS_PRICING,
  type DayPassPricingParams,
} from "./pricing";

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

/**
 * Lucky Break Lifetime-upgrade odds, read from the environment so they can be
 * retuned without a redeploy. `BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY` is a
 * decimal fraction in [0,1] (e.g. `0.2` = 20%). The value lives ONLY on the
 * server, so clients can never see or tamper with it — the disclosed odds are
 * always whatever this returns (the plans catalog + roll result echo it back).
 *
 * Falls back to the documented default (the pure engine's
 * `LUCKY_BREAK_LIFETIME_PROBABILITY`) when unset, and logs a warning + uses the
 * default when the value is malformed or out of range, so a typo can never
 * break the draw. Restart the API server after changing the env var.
 */
export function luckyBreakLifetimeProbability(): number {
  const raw = process.env.BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY;
  if (raw === undefined || raw.trim() === "") {
    return LUCKY_BREAK_LIFETIME_PROBABILITY;
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    logger.warn(
      { value: raw, default: LUCKY_BREAK_LIFETIME_PROBABILITY },
      "Invalid BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY (expected a number in [0,1]); using default",
    );
    return LUCKY_BREAK_LIFETIME_PROBABILITY;
  }
  return parsed;
}

/**
 * In-app card checkout (one-time pass purchase + recurring subscriptions).
 *
 * DEFAULT OFF. The processor-backed flows are kept intact behind this flag so
 * they can be switched back on without a code change, but while it's off the
 * product sells access exclusively through Lucky Break redeem codes. When off:
 *   - /passes/checkout, /passes/verify and /subscriptions/checkout,
 *     /subscriptions/verify return a friendly { success: false } message.
 *   - /subscriptions/cancel stays ON so anyone with a legacy subscription can
 *     still stop it renewing.
 *   - /passes/plans reports cardPaymentsEnabled:false so the client hides the
 *     card purchase UI and leads with Lucky Break.
 */
export function cardPaymentsEnabled(): boolean {
  return envFlag("BREAKBPM_CARD_PAYMENTS_ENABLED", false);
}

/** User-facing copy when a card flow is hit while card payments are off. */
export const CARD_PAYMENTS_OFF_MESSAGE =
  "Card checkout is currently closed — unlock access with a Lucky Break code instead.";

/**
 * Self-custody on-chain crypto checkout (one-time passes paid in USDC or
 * native ETH on Base L2).
 *
 * DEFAULT OFF. Even when this flag is on, the flow only actually opens once a
 * receiving wallet address is configured (BREAKBPM_CRYPTO_RECEIVING_ADDRESS) —
 * see `cryptoConfigured()` in cryptoChain.ts, which the /crypto routes and the
 * /passes/plans catalog gate on. While off, /crypto/quote and /crypto/verify
 * return a friendly { success: false } message and the client hides the crypto
 * panel. There are NO crypto subscriptions — recurring plans stay card-only.
 */
export function cryptoPaymentsEnabled(): boolean {
  return envFlag("BREAKBPM_CRYPTO_PAYMENTS_ENABLED", false);
}

/** User-facing copy when a crypto flow is hit while crypto payments are off. */
export const CRYPTO_PAYMENTS_OFF_MESSAGE =
  "Crypto checkout isn't open right now. Check back soon or use a code.";

/**
 * Admin identity allowlist. `BREAKBPM_ADMIN_EMAILS` is a comma-separated list
 * of account emails treated as admins. Parsed (and lowercased) on every call
 * so flipping the env var never leaves stale state anywhere. The list itself
 * is NEVER sent to clients — callers resolve a single per-user boolean via
 * `isAdminEmail` and ship only that.
 */
export function adminEmails(): Set<string> {
  const raw = process.env.BREAKBPM_ADMIN_EMAILS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

/** True when `email` is on the admin allowlist (case-insensitive). */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().has(email.trim().toLowerCase());
}

/**
 * Owner-curated blocklist for user-supplied free text (HUD ad copy + custom
 * screen names). `BREAKBPM_BANNED_WORDS` is a comma-separated list of words or
 * phrases, parsed (and lowercased) on every call so editing the env var never
 * leaves stale state. Matching is whole-word/case-insensitive (see
 * `findBannedWord` in wordFilter.ts), so e.g. banning `ass` blocks a standalone
 * "ass" but not "passes". Empty/unset = no filtering. Restart the API server
 * after changing.
 */
export function bannedWords(): string[] {
  const raw = process.env.BREAKBPM_BANNED_WORDS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0);
}

/** Default per-pool monthly stock for the landing-page free-pass giveaway. */
export const FREE_PASS_MONTHLY_CAP_DEFAULT = 15;

/**
 * Per-pool monthly cap for the landing-page free-pass giveaway. Each reward
 * pool (Lucky Break roll, Day pass) independently allows this many claims per
 * calendar month; a new month is a fresh pool, so stock "resets" on the 1st
 * with no scheduled job. Read from `BREAKBPM_FREE_PASS_MONTHLY_CAP` (a
 * non-negative integer; 0 closes the giveaway). Blank/invalid values log a
 * warning and fall back to the default. Restart the API server after changing.
 */
export function freePassMonthlyCap(): number {
  const raw = process.env.BREAKBPM_FREE_PASS_MONTHLY_CAP;
  if (raw === undefined || raw.trim() === "") return FREE_PASS_MONTHLY_CAP_DEFAULT;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    logger.warn(
      { value: raw, default: FREE_PASS_MONTHLY_CAP_DEFAULT },
      "Invalid BREAKBPM_FREE_PASS_MONTHLY_CAP (expected a non-negative integer); using default",
    );
    return FREE_PASS_MONTHLY_CAP_DEFAULT;
  }
  return parsed;
}

/**
 * Off-platform card store URL (Squarespace) where buyers can purchase the
 * 14 Day Pass by card. The owner manually mints + emails a redeem code after a
 * sale. Read fresh from `BREAKBPM_STORE_URL` on every request so the link can
 * be swapped at runtime; returns "" when unset, which the client treats as "no
 * store configured" and hides the card-store callout. Restart not required for
 * the static frontend — just the API server picks up the new env value.
 */
export function storeUrl(): string {
  const raw = process.env.BREAKBPM_STORE_URL;
  if (raw === undefined || raw.trim() === "") return "";
  return raw.trim();
}

/**
 * Read a positive-integer env var, falling back to `defaultValue` when unset,
 * blank, or invalid (a warning is logged on a malformed value). `min` clamps
 * the floor (e.g. 1 for "at least one day"); values below it fall back too.
 */
function envInt(name: string, defaultValue: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < min) {
    logger.warn(
      { value: raw, default: defaultValue },
      `Invalid ${name} (expected an integer >= ${min}); using default`,
    );
    return defaultValue;
  }
  return parsed;
}

/**
 * Base daily rate (USD cents) for a user-bought HUD ad, before the demand
 * multiplier + floor (see pricing.ts `computeAdQuote`). Read from
 * `BREAKBPM_AD_BASE_DAILY_CENTS`; defaults to $6.90/day. Restart after change.
 */
export function adBaseDailyCents(): number {
  return envInt("BREAKBPM_AD_BASE_DAILY_CENTS", AD_BASE_DAILY_CENTS_DEFAULT, 1);
}

/**
 * Floor for the effective daily ad rate (USD cents). The multiplier can push
 * the computed rate very low (or to zero) when there's little activity, so this
 * is the minimum a buyer ever pays per day. Read from
 * `BREAKBPM_AD_MIN_DAILY_CENTS`; defaults to $1.00/day. Restart after change.
 */
export function adMinDailyCents(): number {
  return envInt("BREAKBPM_AD_MIN_DAILY_CENTS", AD_MIN_DAILY_CENTS_DEFAULT, 0);
}

/**
 * Maximum run length (days) a buyer may purchase for one ad. Read from
 * `BREAKBPM_AD_MAX_DAYS`; defaults to 369. Restart after change.
 */
export function adMaxDays(): number {
  return envInt("BREAKBPM_AD_MAX_DAYS", AD_MAX_DAYS_DEFAULT, 1);
}

/**
 * Flexible "purchase days of access" crypto pass pricing, read from the
 * environment so the per-day rate can be retuned without a redeploy (see
 * pricing.ts `computeDayPassPriceCents` + DAY_PASS_PRICING for the math). The
 * params are shipped to the client via /passes/plans so the live slider
 * estimate and the server-frozen quote always use the SAME numbers — the
 * server stays authoritative. `minDays` is fixed at 1. Blank/invalid values log
 * a warning and fall back to the default. Restart the API server after changing.
 *
 *   - BREAKBPM_DAY_PASS_FIRST_DAY_CENTS  first-day flat fee, cents (default 199)
 *   - BREAKBPM_DAY_PASS_MID_RATE_CENTS   per-day add for days 2..threshold (default 10)
 *   - BREAKBPM_DAY_PASS_MID_THRESHOLD    day the cheaper bracket starts (default 30)
 *   - BREAKBPM_DAY_PASS_LONG_RATE_CENTS  per-day add beyond the threshold (default 3)
 *   - BREAKBPM_DAY_PASS_MAX_DAYS         longest purchasable run, days (default 365)
 */
export function dayPassPricing(): DayPassPricingParams {
  return {
    minDays: DAY_PASS_PRICING.minDays,
    maxDays: envInt("BREAKBPM_DAY_PASS_MAX_DAYS", DAY_PASS_PRICING.maxDays, 1),
    firstDayCents: envInt(
      "BREAKBPM_DAY_PASS_FIRST_DAY_CENTS",
      DAY_PASS_PRICING.firstDayCents,
      0,
    ),
    midRateCents: envInt(
      "BREAKBPM_DAY_PASS_MID_RATE_CENTS",
      DAY_PASS_PRICING.midRateCents,
      0,
    ),
    midThreshold: envInt(
      "BREAKBPM_DAY_PASS_MID_THRESHOLD",
      DAY_PASS_PRICING.midThreshold,
      1,
    ),
    longRateCents: envInt(
      "BREAKBPM_DAY_PASS_LONG_RATE_CENTS",
      DAY_PASS_PRICING.longRateCents,
      0,
    ),
  };
}

/** Default length (hours) of the invite-link free trial pass. */
export const INVITE_TRIAL_HOURS_DEFAULT = 6;

/**
 * Length (in hours) of the free trial pass granted when a NEW user redeems
 * someone's invite link. Read from `BREAKBPM_INVITE_TRIAL_HOURS`; defaults to 6
 * hours. Blank/invalid values log a warning and fall back to the default.
 * Restart the API server after changing.
 */
export function inviteTrialHours(): number {
  return envInt("BREAKBPM_INVITE_TRIAL_HOURS", INVITE_TRIAL_HOURS_DEFAULT, 1);
}

/**
 * Human-readable, adjectival label for the invite trial length (e.g. "6-hour").
 * Single source of truth for trial-length copy: the server ships it to the
 * client (InviteCodeResult.trialLabel) so the account-page copy never drifts
 * from the configured duration.
 */
export function inviteTrialLabel(): string {
  return `${inviteTrialHours()}-hour`;
}

/** Default splash QR target when no promo override is configured. */
export const DEFAULT_PROMO_QR_URL = "https://breakbpm.com";

/**
 * URL encoded into the splash-art QR easter egg, served to the client via
 * `GET /config`. Read fresh from `BREAKBPM_PROMO_QR_URL` on every request so a
 * promo link can be swapped at runtime (the static frontend bakes nothing in —
 * just restart the API server after changing the secret). Falls back to the
 * marketing site when unset or blank.
 */
export function promoQrUrl(): string {
  const raw = process.env.BREAKBPM_PROMO_QR_URL;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PROMO_QR_URL;
  return raw.trim();
}
