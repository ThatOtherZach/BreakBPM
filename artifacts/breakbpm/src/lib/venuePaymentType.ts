import { VenuePaymentType } from "@workspace/api-client-react";

/**
 * Single source of truth for verified-venue payment-type display. The stored
 * values are stable tokens (`free` / `per_game` / `hourly`, from the API
 * contract); this module maps them to human labels + a small glyph so labels
 * can change without a data migration. Replaces the old convention of baking
 * the pricing model into the venue name (e.g. "… (Hourly)").
 */

/** Non-null payment-type tokens, in the order shown in the admin dropdown. */
export const VENUE_PAYMENT_TYPES = [
  VenuePaymentType.free,
  VenuePaymentType.per_game,
  VenuePaymentType.hourly,
] as const;

type PaymentToken = (typeof VENUE_PAYMENT_TYPES)[number];

const LABELS: Record<PaymentToken, string> = {
  free: "Free Play",
  per_game: "Pay Per Game",
  hourly: "Hourly",
};

const ICONS: Record<PaymentToken, string> = {
  free: "🆓",
  per_game: "🪙",
  hourly: "⏱️",
};

function isPaymentToken(t: VenuePaymentType | null | undefined): t is PaymentToken {
  return t != null && t in LABELS;
}

/** Display label for a known token (used by the admin dropdown options). */
export function venuePaymentLabel(token: PaymentToken): string {
  return LABELS[token];
}

/**
 * Badge content for a venue's (possibly null/unknown) payment type. Returns
 * `null` when the type is unset so callers render nothing.
 */
export function venuePaymentBadge(
  t: VenuePaymentType | null | undefined,
): { label: string; icon: string } | null {
  if (!isPaymentToken(t)) return null;
  return { label: LABELS[t], icon: ICONS[t] };
}
