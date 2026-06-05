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
