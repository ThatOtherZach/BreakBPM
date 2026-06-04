import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { mountAuth } from "./lib/serverAuthAdapter";
import router from "./routes";
import { logger } from "./lib/logger";
import { WebhookHandlers } from "./lib/webhookHandlers";
import { parseVerifiedStripeEvent } from "./lib/stripeClient";
import { reconcileStripeEvent } from "./lib/stripeReconcile";

const app: Express = express();

// We always sit behind the Replit shared reverse proxy. Honor a single
// hop of forwarding headers so req.ip / req.protocol reflect the real
// client rather than the proxy.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// Stripe webhook MUST be registered before mountAuth and express.json — the
// signature check needs the raw request body as a Buffer, and any upstream
// body parser would consume/transform it first. StripeSync keeps the mirrored
// `stripe` schema fresh; reconcileStripeEvent applies entitlement changes
// (passes/subscriptions) authoritatively. Both are idempotent.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature" });
      return;
    }
    const sig = Array.isArray(signature) ? signature[0] : signature;
    try {
      // processWebhook verifies the signature (throws on mismatch) AND keeps
      // the mirrored `stripe` schema fresh. Only after it succeeds is the raw
      // body proven authentic, so we then parse it for entitlement reconcile.
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      const event = parseVerifiedStripeEvent(req.body as Buffer);
      await reconcileStripeEvent(event);
      res.status(200).json({ received: true });
    } catch (err) {
      // Non-2xx tells Stripe to retry. Our handlers are idempotent, so a
      // retry after a transient failure is safe.
      logger.error({ err }, "Stripe webhook processing failed");
      res.status(500).json({ error: "Webhook processing error" });
    }
  },
);

// All auth-provider wiring (currently Clerk) lives behind this single call.
mountAuth(app);

app.use(cors({ credentials: true, origin: true }));
// Cap request bodies — `gameState` is a free-form jsonb, so we constrain the
// whole payload here rather than per-field. 64KB comfortably fits a finished
// 8/9-ball game's shotLog while denying obvious DoS attempts.
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
