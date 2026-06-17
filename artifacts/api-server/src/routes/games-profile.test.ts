import { describe, it, expect, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

// The profile route is public (no auth), but games.ts still imports the auth
// lib at module load. Stub it so the suite never touches Clerk.
vi.mock("../lib/auth", () => ({
  getOrCreateUser: vi.fn(async () => null),
  getVerifiedSubject: vi.fn(async () => null),
}));

import gamesRouter from "./games";
import { backgroundVariantForKey } from "../lib/profileBackground";
import { createUser, seedPass, cleanup } from "../test/factories";

function makeApp(): Express {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      info() {},
      warn() {},
      error() {},
    };
    next();
  });
  app.use("/api", gamesRouter);
  return app;
}

const app = makeApp();

/** Unique source IP per request → its own rate-limit bucket. */
function freshIp(): string {
  const o = () => Math.floor(Math.random() * 254) + 1;
  return `10.${o()}.${o()}.${o()}`;
}

/** Fetch a public profile by screen name. */
async function fetchProfile(name: string): Promise<request.Response> {
  return request(app)
    .get("/api/games/profile")
    .set("X-Forwarded-For", freshIp())
    .query({ name });
}

/** Overwrite a user's stored profile-theme preference. */
async function setTheme(userId: string, theme: string | null): Promise<void> {
  await db.update(usersTable).set({ profileTheme: theme }).where(eq(usersTable.id, userId));
}

afterEach(async () => {
  vi.clearAllMocks();
  await cleanup();
});

describe("GET /games/profile — profileBackground wiring", () => {
  it("returns a non-null background for a paid host with a card-redeemed pass", async () => {
    const host = await createUser();
    // A discount-code pass carries a redeem card; its code is the derivation
    // key so the profile artwork matches the printed card.
    await seedPass(host.id, "lifetime", { source: "discount_code", sourceRef: "CARD-TEST" });

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBe(backgroundVariantForKey("CARD-TEST"));
    expect(res.body.profileBackground).not.toBeNull();
  });

  it("returns a null background for a paid host whose pass carried no card", async () => {
    const host = await createUser();
    // A 'grant' pass has no sourceRef (no card) → nothing to derive → plain.
    await seedPass(host.id, "lifetime");

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBeNull();
  });

  it("headline pass wins: a longer non-card pass yields plain even with a card pass present", async () => {
    const host = await createUser();
    // A short card pass that would derive artwork on its own...
    await seedPass(host.id, "month", {
      source: "discount_code",
      sourceRef: "CARD-X",
      durationSeconds: 30 * 24 * 60 * 60,
    });
    // ...but a longer-expiring lifetime grant (no card) is the headline pass,
    // and it carries no redeem code → nothing to derive → plain. This is a
    // deliberate product rule (theme follows the headline/longest pass).
    await seedPass(host.id, "lifetime"); // grant, durationSeconds=null → never expires

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBeNull();
  });

  it("returns a null background for an unpaid host", async () => {
    const host = await createUser();

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBeNull();
  });

  describe("Theme override path (paid host)", () => {
    it("'none' → null background", async () => {
      const host = await createUser();
      await seedPass(host.id, "lifetime");
      await setTheme(host.id, "none");

      const res = await fetchProfile(host.screenName);

      expect(res.status).toBe(200);
      expect(res.body.profileBackground).toBeNull();
    });

    it("an explicit variant → that variant", async () => {
      const host = await createUser();
      await seedPass(host.id, "lifetime");
      await setTheme(host.id, "hustler");

      const res = await fetchProfile(host.screenName);

      expect(res.status).toBe(200);
      expect(res.body.profileBackground).toBe("hustler");
    });

    it("'auto' → derived from the headline pass's redeem code", async () => {
      const host = await createUser();
      await seedPass(host.id, "lifetime", { source: "discount_code", sourceRef: "CARD-TEST" });
      await setTheme(host.id, "auto");

      const res = await fetchProfile(host.screenName);

      expect(res.status).toBe(200);
      expect(res.body.profileBackground).toBe(backgroundVariantForKey("CARD-TEST"));
    });
  });
});
