import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

// Mutable test state shared with the module mocks. Declared via vi.hoisted so
// it is initialised before the (hoisted) vi.mock factories run.
const mocks = vi.hoisted(() => ({
  currentUser: null as { id: string } | null,
}));

// Stub auth: PATCH /auth/profile-theme calls getOrCreateUser to bind the action
// to the signed-in user. The public /games/state and /games/profile handlers do
// not consult the caller's identity (they key off share code / screen name), but
// games.ts still imports the auth lib at module load, so it must be stubbed.
vi.mock("../lib/auth", () => ({
  getOrCreateUser: vi.fn(async () => mocks.currentUser),
  getVerifiedSubject: vi.fn(async () =>
    mocks.currentUser ? { provider: "test", subject: mocks.currentUser.id } : null,
  ),
  needsOnboarding: vi.fn(() => false),
}));

import authRouter from "./auth";
import gamesRouter from "./games";
import {
  createUser,
  seedPass,
  seedSubscription,
  seedGame,
  seedParticipant,
  expirePass,
  cleanup,
} from "../test/factories";

// A fixed email placed on the admin allowlist for the duration of this suite.
const ADMIN_EMAIL = "rainbow-admin-test@breakbpm.test";
let prevAdminEmails: string | undefined;

beforeAll(() => {
  prevAdminEmails = process.env.BREAKBPM_ADMIN_EMAILS;
  process.env.BREAKBPM_ADMIN_EMAILS = ADMIN_EMAIL;
});

afterAll(() => {
  if (prevAdminEmails === undefined) delete process.env.BREAKBPM_ADMIN_EMAILS;
  else process.env.BREAKBPM_ADMIN_EMAILS = prevAdminEmails;
});

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
  app.use("/api", authRouter);
  app.use("/api", gamesRouter);
  return app;
}

const app = makeApp();

/** Unique source IP per request → its own rate-limit bucket. */
function freshIp(): string {
  const o = () => Math.floor(Math.random() * 254) + 1;
  return `10.${o()}.${o()}.${o()}`;
}

/** Overwrite a user's stored profile-theme preference. */
async function setTheme(userId: string, theme: string | null): Promise<void> {
  await db.update(usersTable).set({ profileTheme: theme }).where(eq(usersTable.id, userId));
}

/** PATCH /auth/profile-theme as the given (mocked-signed-in) user. */
async function patchTheme(
  user: { id: string } | null,
  theme: string,
): Promise<request.Response> {
  mocks.currentUser = user;
  return request(app).patch("/api/auth/profile-theme").send({ profileTheme: theme });
}

/** Fetch the host participant's rainbowName flag from /games/state by code. */
async function fetchHostParticipant(
  shareCode: string,
): Promise<{ status: number; participant: { rainbowName: boolean } | undefined }> {
  const res = await request(app)
    .get("/api/games/state")
    .set("X-Forwarded-For", freshIp())
    .query({ code: shareCode });
  const participant = (res.body.participants ?? []).find(
    (p: { isHost: boolean }) => p.isHost,
  );
  return { status: res.status, participant };
}

/** Fetch a public profile by screen name. */
async function fetchProfile(name: string): Promise<request.Response> {
  return request(app)
    .get("/api/games/profile")
    .set("X-Forwarded-For", freshIp())
    .query({ name });
}

afterEach(async () => {
  mocks.currentUser = null;
  vi.clearAllMocks();
  await cleanup();
});

// ---------------------------------------------------------------------------
// PATCH /auth/profile-theme — who may turn on the rainbow name?
// ---------------------------------------------------------------------------

describe("PATCH /auth/profile-theme — rainbow eligibility matrix", () => {
  it("admin → accepts 'rainbow'", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });

    const res = await patchTheme(admin, "rainbow");

    expect(res.status).toBe(200);
    expect(res.body.profileTheme).toBe("rainbow");
  });

  it("active one-time pass → accepts 'rainbow'", async () => {
    const user = await createUser();
    await seedPass(user.id, "day");

    const res = await patchTheme(user, "rainbow");

    expect(res.status).toBe(200);
    expect(res.body.profileTheme).toBe("rainbow");
  });

  it("active-subscription-only → accepts 'rainbow'", async () => {
    const user = await createUser();
    await seedSubscription(user.id, { status: "active" });

    const res = await patchTheme(user, "rainbow");

    expect(res.status).toBe(200);
    expect(res.body.profileTheme).toBe("rainbow");
  });

  it("expired pass → rejects 'rainbow' (403)", async () => {
    const user = await createUser();
    const pass = await seedPass(user.id, "day");
    await expirePass(pass.id);

    const res = await patchTheme(user, "rainbow");

    expect(res.status).toBe(403);
  });

  it("plain account → rejects 'rainbow' (403)", async () => {
    const user = await createUser();

    const res = await patchTheme(user, "rainbow");

    expect(res.status).toBe(403);
  });

  it("signed-out → 401", async () => {
    const res = await patchTheme(null, "rainbow");

    expect(res.status).toBe(401);
  });

  it("a 'rainbow' pick pins no felt artwork (background stays plain)", async () => {
    const user = await createUser();
    await seedPass(user.id, "day");

    const res = await patchTheme(user, "rainbow");

    expect(res.status).toBe(200);
    expect(res.body.profileTheme).toBe("rainbow");
    // rainbow is a name-only flair — it must NOT resolve to a felt artwork.
    expect(res.body.profileBackground).toBeNull();
  });
});

describe("PATCH /auth/profile-theme — artwork stays Lifetime/admin-only", () => {
  it("admin → accepts artwork ('shark')", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });

    const res = await patchTheme(admin, "shark");

    expect(res.status).toBe(200);
    expect(res.body.profileTheme).toBe("shark");
  });

  it("active Lifetime pass → accepts artwork ('hustler')", async () => {
    const user = await createUser();
    await seedPass(user.id, "lifetime");

    const res = await patchTheme(user, "hustler");

    expect(res.status).toBe(200);
    expect(res.body.profileTheme).toBe("hustler");
  });

  it("active one-time (non-Lifetime) pass → rejects artwork (403)", async () => {
    const user = await createUser();
    await seedPass(user.id, "day");

    const res = await patchTheme(user, "shark");

    expect(res.status).toBe(403);
  });

  it("active-subscription-only → rejects artwork (403)", async () => {
    const user = await createUser();
    await seedSubscription(user.id, { status: "active" });

    const res = await patchTheme(user, "pool-player");

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /games/state — participant rainbowName
// ---------------------------------------------------------------------------

/** Seed a game whose host carries the given pass/subscription/theme setup. */
async function seedRainbowGame(
  setup: (hostId: string) => Promise<void>,
  opts: { email?: string | null } = {},
) {
  const host = await createUser({ email: opts.email ?? null });
  await setup(host.id);
  const game = await seedGame(host.id, { hostName: "Hosty" });
  return { host, game };
}

describe("GET /games/state — participant rainbowName matrix", () => {
  it("admin host → rainbowName true", async () => {
    const { game } = await seedRainbowGame(async () => {}, { email: ADMIN_EMAIL });

    const { status, participant } = await fetchHostParticipant(game.shareCode);

    expect(status).toBe(200);
    expect(participant?.rainbowName).toBe(true);
  });

  it("active one-time pass + theme 'rainbow' → true", async () => {
    const { game } = await seedRainbowGame(async (hostId) => {
      await seedPass(hostId, "day");
      await setTheme(hostId, "rainbow");
    });

    const { status, participant } = await fetchHostParticipant(game.shareCode);

    expect(status).toBe(200);
    expect(participant?.rainbowName).toBe(true);
  });

  it("active subscription + theme 'rainbow' → true", async () => {
    const { game } = await seedRainbowGame(async (hostId) => {
      await seedSubscription(hostId, { status: "active" });
      await setTheme(hostId, "rainbow");
    });

    const { status, participant } = await fetchHostParticipant(game.shareCode);

    expect(status).toBe(200);
    expect(participant?.rainbowName).toBe(true);
  });

  it("expired pass + theme 'rainbow' → false", async () => {
    const { game } = await seedRainbowGame(async (hostId) => {
      const pass = await seedPass(hostId, "day");
      await expirePass(pass.id);
      await setTheme(hostId, "rainbow");
    });

    const { status, participant } = await fetchHostParticipant(game.shareCode);

    expect(status).toBe(200);
    expect(participant?.rainbowName).toBe(false);
  });

  it("plain account + theme 'rainbow' → false", async () => {
    const { game } = await seedRainbowGame(async (hostId) => {
      await setTheme(hostId, "rainbow");
    });

    const { status, participant } = await fetchHostParticipant(game.shareCode);

    expect(status).toBe(200);
    expect(participant?.rainbowName).toBe(false);
  });

  it("paid host with a non-rainbow theme → false", async () => {
    const { game } = await seedRainbowGame(async (hostId) => {
      await seedPass(hostId, "lifetime");
      await setTheme(hostId, "shark");
    });

    const { status, participant } = await fetchHostParticipant(game.shareCode);

    expect(status).toBe(200);
    expect(participant?.rainbowName).toBe(false);
  });

  it("guest participant (no account) → false", async () => {
    const host = await createUser();
    await seedPass(host.id, "lifetime");
    const game = await seedGame(host.id, { maxPlayers: 2, hostName: "Host" });
    // A guest joiner: a participant row with no userId, even in a paid host's game.
    await seedParticipant(game.id, 1, { userId: null, displayName: "Guesty" });

    const res = await request(app)
      .get("/api/games/state")
      .set("X-Forwarded-For", freshIp())
      .query({ code: game.shareCode });

    expect(res.status).toBe(200);
    const guest = res.body.participants.find(
      (p: { isGuest: boolean }) => p.isGuest,
    );
    expect(guest?.rainbowName).toBe(false);
  });

  it("the rainbow theme pins no host felt (hostTheme stays null)", async () => {
    const { game } = await seedRainbowGame(async (hostId) => {
      await seedPass(hostId, "day");
      await setTheme(hostId, "rainbow");
    });

    const res = await request(app)
      .get("/api/games/state")
      .set("X-Forwarded-For", freshIp())
      .query({ code: game.shareCode });

    expect(res.status).toBe(200);
    expect(res.body.hostTheme).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /games/profile — host rainbowName
// ---------------------------------------------------------------------------

describe("GET /games/profile — host rainbowName matrix", () => {
  it("admin → rainbowName true", async () => {
    const host = await createUser({ email: ADMIN_EMAIL });

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.rainbowName).toBe(true);
  });

  it("active one-time pass + theme 'rainbow' → true", async () => {
    const host = await createUser();
    await seedPass(host.id, "day");
    await setTheme(host.id, "rainbow");

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.rainbowName).toBe(true);
  });

  it("active subscription + theme 'rainbow' → true", async () => {
    const host = await createUser();
    await seedSubscription(host.id, { status: "active" });
    await setTheme(host.id, "rainbow");

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.rainbowName).toBe(true);
  });

  it("expired pass + theme 'rainbow' → false", async () => {
    const host = await createUser();
    const pass = await seedPass(host.id, "day");
    await expirePass(pass.id);
    await setTheme(host.id, "rainbow");

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.rainbowName).toBe(false);
  });

  it("plain account + theme 'rainbow' → false", async () => {
    const host = await createUser();
    await setTheme(host.id, "rainbow");

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.rainbowName).toBe(false);
  });

  it("paid host with a non-rainbow theme → false", async () => {
    const host = await createUser();
    await seedPass(host.id, "lifetime");
    await setTheme(host.id, "shark");

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.rainbowName).toBe(false);
  });

  it("a 'rainbow' host pins no felt artwork (profileBackground stays null)", async () => {
    const host = await createUser();
    await seedPass(host.id, "day");
    await setTheme(host.id, "rainbow");

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.rainbowName).toBe(true);
    expect(res.body.profileBackground).toBeNull();
  });
});
