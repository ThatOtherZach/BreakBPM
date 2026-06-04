import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

/**
 * Fetches Stripe credentials from the Replit connection API.
 * Not cached -- tokens can rotate, so fetch fresh each time. Throws when the
 * Stripe integration isn't connected; callers in the payment seam catch this
 * and surface a friendly "card payments aren't configured yet" message.
 */
export async function getStripeCredentials(): Promise<{
  secretKey: string;
}> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      "Missing Replit environment variables. " +
        "Ensure the Stripe integration is connected via the Integrations tab.",
    );
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!resp.ok) {
    throw new Error(
      `Failed to fetch Stripe credentials: ${resp.status} ${resp.statusText}`,
    );
  }

  // The Replit Stripe connector exposes the secret key as `settings.secret`
  // (not `secret_key`). There is no webhook secret here — StripeSync manages
  // the webhook's signing secret itself via findOrCreateManagedWebhook.
  const data = (await resp.json()) as {
    items?: { settings?: { secret?: string } }[];
  };
  const secret = data.items?.[0]?.settings?.secret;

  if (!secret) {
    throw new Error(
      "Stripe integration not connected or missing secret key. " +
        "Connect Stripe via the Integrations tab first.",
    );
  }

  return { secretKey: secret };
}

/**
 * Returns a fresh authenticated Stripe client.
 * Not cached -- fetches credentials on every call so rotated keys are picked up.
 */
export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

/**
 * Returns a fresh StripeSync instance for webhook processing and data sync.
 * Not cached -- fetches credentials on every call so rotated keys are picked up.
 */
export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const { secretKey } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    // Managed webhooks own their signing secret (stored in the synced schema
    // by findOrCreateManagedWebhook). processWebhook looks it up internally, so
    // no static webhook secret is needed here.
    stripeWebhookSecret: "",
  });
}

/**
 * Parse an already-verified webhook payload into a typed Stripe event.
 *
 * Signature verification is owned by StripeSync.processWebhook (it checks the
 * payload against the managed webhook's signing secret and throws on mismatch).
 * Callers MUST run processWebhook first; once it succeeds the raw buffer is
 * authentic, so we can safely JSON-parse it for our own reconciliation dispatch
 * without re-verifying (we don't have direct access to the managed secret).
 */
export function parseVerifiedStripeEvent(payload: Buffer): Stripe.Event {
  return JSON.parse(payload.toString("utf8")) as Stripe.Event;
}
