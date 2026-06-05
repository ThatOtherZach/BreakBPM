/**
 * Runtime feature flags read from the environment. Centralized so every
 * handler agrees on the same answer and the defaults are documented in one
 * place.
 */

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  return /^(1|true|yes|on)$/i.test(raw.trim());
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
