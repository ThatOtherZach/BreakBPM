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
import {
  createUser,
  seedPass,
  seedDiscountCode,
  seedGame,
  seedParticipant,
  cleanup,
} from "../test/factories";

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

/** Seed a redeemed-card pass: a discount code carrying a stored artwork variant
 * plus an active pass whose sourceRef points back at that code. */
async function seedCardPass(
  userId: string,
  code: string,
  variant: string,
  kind: Parameters<typeof seedPass>[1] = "lifetime",
  passOpts: Parameters<typeof seedPass>[2] = {},
): Promise<void> {
  await seedDiscountCode(code, kind, { backgroundVariant: variant });
  await seedPass(userId, kind, { source: "discount_code", sourceRef: code, ...passOpts });
}

afterEach(async () => {
  vi.clearAllMocks();
  await cleanup();
});

describe("GET /games/profile — profileBackground wiring", () => {
  it("returns the stored card artwork for a paid host with a card-redeemed pass", async () => {
    const host = await createUser();
    // The redeem card stored 'hustler' at mint time; the profile must wear
    // exactly that — no derivation from the code string.
    await seedCardPass(host.id, "CARD-TEST", "hustler");

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBe("hustler");
  });

  it("returns a null background for a paid host whose pass carried no card", async () => {
    const host = await createUser();
    // A 'grant' pass has no sourceRef (no card) → nothing stored → plain.
    await seedPass(host.id, "lifetime");

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBeNull();
  });

  it("returns null when the card was minted without artwork", async () => {
    const host = await createUser();
    // A discount-code pass whose code stored no artwork (includeArtwork off).
    await seedDiscountCode("CARD-NOART", "lifetime", { backgroundVariant: null });
    await seedPass(host.id, "lifetime", { source: "discount_code", sourceRef: "CARD-NOART" });

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBeNull();
  });

  it("a redeemed-card pass applies its stored artwork even alongside a longer non-card pass", async () => {
    const host = await createUser();
    // A redeemed card (discount-code pass) carries stored artwork...
    await seedCardPass(host.id, "CARD-X", "pool-player", "month", {
      durationSeconds: 30 * 24 * 60 * 60,
    });
    // ...and a longer-expiring non-card grant must NOT suppress it.
    await seedPass(host.id, "lifetime"); // grant, no card

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBe("pool-player");
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

    it("an explicit variant → that variant (beats the stored card variant)", async () => {
      const host = await createUser();
      await seedCardPass(host.id, "CARD-OVR", "shark");
      await setTheme(host.id, "hustler");

      const res = await fetchProfile(host.screenName);

      expect(res.status).toBe(200);
      expect(res.body.profileBackground).toBe("hustler");
    });

    it("'auto' → the stored artwork of an active redeemed-card pass", async () => {
      const host = await createUser();
      await seedCardPass(host.id, "CARD-TEST", "shark");
      await setTheme(host.id, "auto");

      const res = await fetchProfile(host.screenName);

      expect(res.status).toBe(200);
      expect(res.body.profileBackground).toBe("shark");
    });
  });
});

describe("GET /games/profile — auto-earned theme from joined games", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("a registered player earns hustler from games they JOINED (not hosted) and won", async () => {
    const host = await createUser();
    const joiner = await createUser();
    const joinerName = "Joiner";
    // 10 completed standard 8-ball games hosted by someone else; the joiner took
    // a non-host seat and won every one. They hosted none of them — earning here
    // proves participation (joins), not just hosting, accrues toward the theme.
    for (let i = 0; i < 10; i++) {
      const g = await seedGame(host.id, {
        gameType: "8ball",
        maxPlayers: 2,
        hostName: "Host",
        winner: joinerName,
        endedAt: new Date(Date.now() - (i + 1) * DAY),
      });
      await seedParticipant(g.id, 1, {
        userId: joiner.id,
        displayName: joinerName,
      });
    }

    const res = await fetchProfile(joiner.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBe("hustler");
  });

  it("a registered host still earns hustler from games they HOSTED and won", async () => {
    const host = await createUser();
    const hostName = "Champ";
    for (let i = 0; i < 10; i++) {
      await seedGame(host.id, {
        gameType: "8ball",
        maxPlayers: 2,
        hostName,
        winner: hostName,
        endedAt: new Date(Date.now() - (i + 1) * DAY),
      });
    }

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBe("hustler");
  });

  it("does not earn when the joined wins are all older than the 30-day window", async () => {
    const host = await createUser();
    const joiner = await createUser();
    const joinerName = "StaleJoiner";
    for (let i = 0; i < 10; i++) {
      const g = await seedGame(host.id, {
        gameType: "8ball",
        maxPlayers: 2,
        hostName: "Host",
        winner: joinerName,
        endedAt: new Date(Date.now() - (i + 31) * DAY), // 31–40 days ago
      });
      await seedParticipant(g.id, 1, {
        userId: joiner.id,
        displayName: joinerName,
      });
    }

    const res = await fetchProfile(joiner.screenName);

    expect(res.status).toBe(200);
    expect(res.body.profileBackground).toBeNull();
  });
});
