/**
 * Pure tax math for the sales ledger. Flat BC-Canada rates, treated as
 * TAX-INCLUSIVE: the gross (what the customer paid) already contains the tax,
 * so we back the tax out rather than add it on. Prices are unchanged by this.
 *
 * A single rate change is a one-line edit of the two bps constants below.
 * Everything (recording paths + back-fill) computes through this one function
 * so the figures can never drift between call sites.
 */

/** GST 5% and PST 7%, in basis points (1% = 100 bps). */
export const GST_RATE_BPS = 500;
export const PST_RATE_BPS = 700;

/**
 * Divisor for backing tax out of a tax-inclusive gross, in bps:
 * 10_000 (100%) + GST + PST. e.g. at 5% + 7% this is 11_200, so
 * gst = gross * 500 / 11_200 (i.e. gross * 5 / 112).
 */
const TAX_INCLUSIVE_DIVISOR_BPS = 10_000 + GST_RATE_BPS + PST_RATE_BPS;

export interface TaxBreakdown {
  gstCents: number;
  pstCents: number;
  netCents: number;
  gstRateBps: number;
  pstRateBps: number;
}

/**
 * Back GST + PST out of a tax-inclusive gross. `netCents` is defined as the
 * remainder (gross − gst − pst), so gst + pst + net always sums EXACTLY back to
 * gross with no rounding gap — even for the $0 comp case (all zeros).
 */
export function computeTaxInclusive(grossCents: number): TaxBreakdown {
  const gstCents = Math.round(
    (grossCents * GST_RATE_BPS) / TAX_INCLUSIVE_DIVISOR_BPS,
  );
  const pstCents = Math.round(
    (grossCents * PST_RATE_BPS) / TAX_INCLUSIVE_DIVISOR_BPS,
  );
  const netCents = grossCents - gstCents - pstCents;
  return {
    gstCents,
    pstCents,
    netCents,
    gstRateBps: GST_RATE_BPS,
    pstRateBps: PST_RATE_BPS,
  };
}
