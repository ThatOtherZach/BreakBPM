import app from "./app";
import { logger } from "./lib/logger";
import { sweepAllStaleGames } from "./lib/forfeit";

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
