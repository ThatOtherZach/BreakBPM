/**
 * Payment provider seam — required interface:
 *
 *   createCheckout(passKind) → opaque token + (optional) checkoutUrl
 *   verifyAndGrant(opaqueToken) → { success, kind } once payment is confirmed
 *
 * The route handlers know nothing about Stripe / PayPal / etc — they just
 * round-trip the opaque token. Swap the singleton at the bottom to plug in a
 * real provider. Discount codes do NOT go through this seam — they're handled
 * directly in /passes/redeem.
 */

// TODO(remove-before-launch): dev-only flag that exposes the free Lifetime
// upgrade button on the Account screen and the matching POST
// /passes/dev-grant-lifetime route. Set to false (or rip out together with
// the route + the AccountScreen button) before going live.
export const DEV_FREE_UPGRADE_ENABLED = true;

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

export interface CreateCheckoutInput {
  userId: string;
  kind: PassKind;
}

export interface CreateCheckoutResult {
  success: boolean;
  message: string;
  /** Opaque, provider-issued token. Hand back to verifyAndGrant. */
  opaqueToken?: string;
  /** Where the user should be sent (Stripe / PayPal redirect, etc). */
  checkoutUrl?: string;
}

export interface VerifyAndGrantResult {
  success: boolean;
  message: string;
  /** Provider-confirmed pass kind — authoritative, NOT taken from client. */
  kind?: PassKind;
  /** Provider-side reference (e.g. Stripe payment intent id). */
  providerRef?: string;
}

export interface PaymentProvider {
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  verifyAndGrant(opaqueToken: string): Promise<VerifyAndGrantResult>;
}

/**
 * No-op payment provider. Both methods REJECT — there's no real billing
 * wired up, so the only paths to a pass right now are discount codes or an
 * admin grant. Swap this out before going live with paid passes.
 */
export class NoopPaymentProvider implements PaymentProvider {
  async createCheckout(): Promise<CreateCheckoutResult> {
    return {
      success: false,
      message:
        "Card payments aren't configured yet. Use a discount code, or check back soon.",
    };
  }
  async verifyAndGrant(): Promise<VerifyAndGrantResult> {
    return {
      success: false,
      message: "Payments aren't configured yet. Nothing to verify.",
    };
  }
}

export const paymentProvider: PaymentProvider = new NoopPaymentProvider();
