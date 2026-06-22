import type { CryptoDayPassPricing } from "@workspace/api-client-react";

/**
 * Client mirror of the server's marginal-bracket day-pass pricing
 * (artifacts/api-server/src/lib/pricing.ts → computeDayPassPriceCents). The
 * server is authoritative — it recomputes and FREEZES the charged amount at
 * quote time — but the slider needs a live estimate, so the shape of the math
 * is duplicated here and MUST stay in lockstep with the server. The bracket
 * PARAMETERS are not hard-coded: they ship from /passes/plans as
 * `catalog.dayPass`, so only the formula lives in both places.
 *
 * Days are clamped to [minDays, maxDays] and floored to an integer so the
 * client estimate and the server-frozen quote always agree to the cent.
 */
export function computeDayPassPriceCents(
  days: number,
  params: CryptoDayPassPricing,
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
