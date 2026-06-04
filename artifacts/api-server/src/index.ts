import { runMigrations } from "stripe-replit-sync";
import app from "./app";
import { logger } from "./lib/logger";
import { sweepAllStaleGames } from "./lib/forfeit";
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

  // Periodic global sweep — closes stale in-progress games even when no
  // user touches an endpoint. Belt-and-suspenders alongside the lazy
  // per-request sweep. Tracked on globalThis so dev hot-reloads don't
  // stack up duplicate intervals.
  const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
  const g = globalThis as { __breakbpmSweepTimer?: NodeJS.Timeout };
  if (g.__breakbpmSweepTimer) clearInterval(g.__breakbpmSweepTimer);
  g.__breakbpmSweepTimer = setInterval(() => {
    sweepAllStaleGames()
      .then((n) => {
        if (n > 0) logger.info({ swept: n }, "Periodic sweep closed stale games");
      })
      .catch((err) => {
        logger.error({ err }, "Periodic sweep failed");
      });
  }, SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive just for the sweep.
  g.__breakbpmSweepTimer.unref?.();
});
