import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { mountAuth } from "./lib/serverAuthAdapter";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// We always sit behind the Replit shared reverse proxy, so honor a single
// hop of forwarding headers when populating req.ip / req.protocol. Without
// this, the cooldown lookup would either always see the proxy IP or trust
// an attacker-controlled X-Forwarded-For header.
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
