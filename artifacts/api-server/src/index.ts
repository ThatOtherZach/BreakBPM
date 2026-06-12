import { runMigrations } from "stripe-replit-sync";
import app from "./app";
import { logger } from "./lib/logger";
import { seedAdminDiscountCodes } from "./lib/seedDiscountCodes";
import { getStripeSync } from "./lib/stripeClient";

/**
 * Initialize the synced `stripe` schema and the managed webhook, then backfill
 * existing Stripe data. Non-fatal: if Stripe isn't connected yet, we log and
 * keep serving — card checkout simply reports "not configured" until the
 * integration is connected.
 */
async function initStripe(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set; skipping Stripe init");
    return;
  }
  await runMigrations({ databaseUrl });
  const stripeSync = await getStripeSync();
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (domain) {
    await stripeSync.findOrCreateManagedWebhook(
      `https://${domain}/api/stripe/webhook`,
    );
  }
  await stripeSync.syncBackfill();
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Ensure admin-issued discount codes exist in this environment. Idempotent
  // (ON CONFLICT DO NOTHING) so it's a safe no-op once seeded.
  seedAdminDiscountCodes().catch((err) => {
    logger.error({ err }, "Admin discount code seed failed");
  });

  // Set up the synced `stripe` schema + managed webhook. Non-fatal so the
  // server still boots when Stripe isn't connected yet.
  initStripe()
    .then(() => logger.info("Stripe initialized"))
    .catch((err) => {
      logger.warn(
        { err },
        "Stripe init skipped/failed (is the integration connected?)",
      );
    });

  // No periodic background sweep: an always-on timer would query the DB every
  // few minutes forever and prevent it from auto-suspending while idle. Stale
  // in-progress games are instead finalized lazily — on the owner's next write
  // (sweepStaleGames) or when a viewer reads the game (finalizeGameIfStale).
});
