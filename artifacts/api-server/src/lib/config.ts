/**
 * Runtime feature flags read from the environment. Centralized so every
 * handler agrees on the same answer and the defaults are documented in one
 * place.
 */

import { logger } from "./logger";
import { LUCKY_BREAK_LIFETIME_PROBABILITY } from "./luckyBreak";

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
