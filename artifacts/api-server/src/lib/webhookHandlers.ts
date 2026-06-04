import { getStripeSync } from "./stripeClient";

/**
 * Minimal webhook handler — hands the raw payload to StripeSync, which
 * verifies the signature and keeps the synced `stripe` schema up to date.
 * Our own entitlement reconciliation runs separately (see stripeReconcile.ts)
 * off the verified, typed event.
 */
export class WebhookHandlers {
  static async processWebhook(
    payload: Buffer,
    signature: string,
  ): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "STRIPE WEBHOOK ERROR: Payload must be a Buffer. " +
          "Received type: " +
          typeof payload +
          ". This usually means express.json() parsed the body before reaching this handler. " +
          "FIX: Ensure webhook route is registered BEFORE app.use(express.json()).",
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);
  }
}
