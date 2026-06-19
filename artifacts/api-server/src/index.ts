import http from "node:http";
import type { Express } from "express";
import { logger } from "./lib/logger";

/**
 * The full Express app pulls in Clerk, the Stripe SDK, viem and the
 * (externalized) stripe-replit-sync package — on the order of ~1-2s of
 * synchronous module evaluation on a 1-vCPU deploy machine. If we did
 * `import app from "./app"` at the top level, ALL of that would run before we
 * bind the port, and the deployer's startup health probe (which fires within
 * the first second and only retries a few times before giving up) loses the
 * race: it hits a not-yet-listening port, gets connection-refused, and fails
 * the promote step even though the app boots fine moments later.
 *
 * Instead we:
 *   1. Bind the port immediately with a tiny bootstrap server that answers the
 *      health probe directly (the entry chunk is a few KB, so time-to-listen is
 *      a few hundred ms regardless of how heavy the app graph is — see the
 *      esbuild `splitting` option in build.mjs, which keeps ./app in its own
 *      chunk that V8 only parses on demand).
 *   2. Keep the event loop FREE after binding so the freshly-bound socket can
 *      actually answer that first probe. Loading ./app parses a multi-MB chunk,
 *      which blocks the event loop synchronously while it runs; if we kicked it
 *      off right after listen, a probe arriving during the parse would queue
 *      behind it and might time out. So we defer the heavy load until *after*
 *      we've answered a health probe (or a short fallback timer fires, for
 *      local/dev where no probe arrives).
 *   3. Hand off to the real Express app once it's loaded. Requests that arrive
 *      before the app is ready wait for it rather than erroring.
 */

const HEALTH_PATH = "/api/healthz";

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

// Populated once the heavy app module finishes evaluating. While null, the
// bootstrap server answers health checks directly and queues everything else.
let appHandler: Express | null = null;
let appLoadStarted = false;
let loadFailed = false;

let resolveReady!: (app: Express) => void;
let rejectReady!: (err: unknown) => void;
const appReady = new Promise<Express>((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});

/**
 * Dynamically import and evaluate the real Express app. This is the expensive,
 * event-loop-blocking step (V8 parses the multi-MB app chunk), so it is only
 * ever called once we no longer need the event loop free to answer a probe.
 * Idempotent — safe to call from every trigger path.
 */
function startAppLoad(): void {
  if (appLoadStarted) {
    return;
  }
  appLoadStarted = true;

  import("./app")
    .then((mod) => {
      appHandler = mod.default;
      resolveReady(mod.default);
      logger.info("Application initialized");
      void initBackground();
    })
    .catch((err) => {
      // A genuine startup failure must not be masked by the bootstrap's early
      // health 200s: reject in-flight waiters and exit so the deployer's
      // promote step fails (a half-broken instance is worse than a clean fail).
      loadFailed = true;
      rejectReady(err);
      logger.error({ err }, "Fatal: application failed to load");
      process.exit(1);
    });
}

const server = http.createServer((req, res) => {
  // Once the real app is loaded, every request (health included) flows through
  // it so behavior is identical to a plain `app.listen`.
  if (appHandler) {
    appHandler(req, res);
    return;
  }

  const path = (req.url ?? "").split("?")[0];

  // Fast path: answer the startup health probe from the lightweight bootstrap,
  // even before the app has loaded, so promotion never races our cold-start
  // import cost. Only AFTER the response has flushed do we kick off the heavy
  // (event-loop-blocking) app load — that way this probe got a prompt 200 and
  // the app starts loading immediately behind it.
  if (req.method === "GET" && path === HEALTH_PATH) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"status":"ok"}', () => {
      setImmediate(startAppLoad);
    });
    return;
  }

  if (loadFailed) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end('{"error":"starting"}');
    return;
  }

  // A non-health request arrived before the app is ready: make sure the app is
  // loading, then serve it once ready instead of erroring early traffic.
  startAppLoad();
  appReady
    .then((app) => app(req, res))
    .catch(() => {
      res.writeHead(503, { "content-type": "application/json" });
      res.end('{"error":"starting"}');
    });
});

server.on("error", (err) => {
  logger.error({ err }, "HTTP server error");
  process.exit(1);
});

server.listen(port, () => {
  logger.info({ port }, "Server listening");

  // Fallback: if no health probe ever arrives (e.g. local dev), still load the
  // app shortly after binding so the server becomes fully functional. In a real
  // deploy the startup probe hits /api/healthz first and triggers the load
  // earlier than this.
  setTimeout(startAppLoad, 500);
});

/**
 * Post-listen, non-fatal background initialization. Everything here is imported
 * lazily so none of it is on the critical path to binding the port.
 */
async function initBackground(): Promise<void> {
  // Ensure admin-issued discount codes exist in this environment. Idempotent
  // (ON CONFLICT DO NOTHING) so it's a safe no-op once seeded.
  try {
    const { seedAdminDiscountCodes } = await import("./lib/seedDiscountCodes");
    await seedAdminDiscountCodes();
  } catch (err) {
    logger.error({ err }, "Admin discount code seed failed");
  }

  // Set up the synced `stripe` schema + managed webhook. Non-fatal so the
  // server still serves when Stripe isn't connected yet.
  try {
    await initStripe();
    logger.info("Stripe initialized");
  } catch (err) {
    logger.warn(
      { err },
      "Stripe init skipped/failed (is the integration connected?)",
    );
  }

  // No periodic background sweep: an always-on timer would query the DB every
  // few minutes forever and prevent it from auto-suspending while idle. Stale
  // in-progress games are instead finalized lazily — on the owner's next write
  // (sweepStaleGames) or when a viewer reads the game (finalizeGameIfStale).
}

/**
 * Initialize the synced `stripe` schema and the managed webhook, then backfill
 * existing Stripe data. Non-fatal: if Stripe isn't connected yet, we log and
 * keep serving — card checkout simply reports "not configured" until the
 * integration is connected.
 *
 * stripe-replit-sync and stripeClient are imported dynamically here (rather
 * than at module top level) so their heavy module graph isn't evaluated before
 * the server starts listening.
 */
async function initStripe(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set; skipping Stripe init");
    return;
  }
  const { runMigrations } = await import("stripe-replit-sync");
  await runMigrations({ databaseUrl });
  const { getStripeSync } = await import("./lib/stripeClient");
  const stripeSync = await getStripeSync();
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (domain) {
    await stripeSync.findOrCreateManagedWebhook(
      `https://${domain}/api/stripe/webhook`,
    );
  }
  await stripeSync.syncBackfill();
}
