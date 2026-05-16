/**
 * Payment provider seam. No real charges yet — this is a stub interface so
 * we can swap in Stripe (or any other provider) later without touching the
 * pass-issuance routes.
 */

export type PassKind = "day" | "year" | "lifetime";

export interface PriceInfo {
  kind: PassKind;
  priceCents: number;
  label: string;
}

export const PASS_PRICES: Record<PassKind, PriceInfo> = {
  day: { kind: "day", priceCents: 199, label: "Day Pass" },
  year: { kind: "year", priceCents: 1299, label: "Year Pass" },
  lifetime: { kind: "lifetime", priceCents: 1999, label: "Lifetime Pass" },
};

export interface ChargeRequest {
  userId: string;
  kind: PassKind;
  paymentToken?: string;
}

export interface ChargeResult {
  success: boolean;
  message: string;
  /** Provider-side reference (e.g. Stripe payment intent id). */
  providerRef?: string;
}

export interface PaymentProvider {
  charge(req: ChargeRequest): Promise<ChargeResult>;
}

/**
 * No-op payment provider — for development. Always succeeds without taking
 * any payment. Replace with a real provider before going live with paid passes.
 */
export class NoopPaymentProvider implements PaymentProvider {
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    return {
      success: true,
      message: `[stub] Granted ${req.kind} pass without charging.`,
      providerRef: `noop_${Date.now()}`,
    };
  }
}

export const paymentProvider: PaymentProvider = new NoopPaymentProvider();
