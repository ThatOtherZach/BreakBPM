/**
 * Single point at which the server wires up its auth provider.
 *
 * All `@clerk/express` and `@clerk/shared` imports live in this file (and in
 * `clerkAuthProvider.ts`). To swap auth backends:
 *
 *   1. Write a new AuthProvider implementation that exposes getIdentity().
 *   2. Replace the body of `mountAuth()` with that provider's middleware.
 *   3. Update the singleton in `./auth.ts`.
 *
 * Routes never import Clerk directly — they call `getOrCreateUser(req)`.
 */
import type { Express } from "express";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "../middlewares/clerkProxyMiddleware";

export function mountAuth(app: Express): void {
  // The Clerk proxy must be mounted BEFORE body parsers — it streams raw bytes.
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
}
