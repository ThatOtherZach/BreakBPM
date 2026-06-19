import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import type { AdminLeaderboardRow } from "../lib/stats";

// GET /admin/leaderboard is the admin-only view of the ranking that exposes the
// hidden anti-cheat signals (composite score, trustedGames, provisional). These
// tests pin the access control and that the resolver is called with the parsed
// mode/window and its rows echoed back.

const mocks = vi.hoisted(() => ({
  currentUser: null as { id: string; email: string | null } | null,
  rows: [] as AdminLeaderboardRow[],
  lastArgs: null as { mode: string; window: string } | null,
}));

vi.mock("../lib/auth", () => ({
  getOrCreateUser: vi.fn(async () => mocks.currentUser),
}));

vi.mock("../lib/stats", () => ({
  resolveAdminLeaderboard: vi.fn(async (mode: string, window: string) => {
    mocks.lastArgs = { mode, window };
    return mocks.rows;
  }),
}));

import adminRouter from "./admin";
import { createUser, cleanup } from "../test/factories";

const ADMIN_EMAIL = "leaderboard-admin-test@breakbpm.test";
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
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = { info() {}, warn() {}, error() {} };
    next();
  });
  app.use("/api", adminRouter);
  return app;
}

const app = makeApp();

function adminRow(over: Partial<AdminLeaderboardRow> & Pick<AdminLeaderboardRow, "rank" | "screenName">): AdminLeaderboardRow {
  return {
    score: 12.3,
    bpm: 40,
    accuracy: 80,
    gamesPlayed: 3,
    trustedGames: 2,
    provisional: true,
    ...over,
  };
}

afterEach(async () => {
  mocks.currentUser = null;
  mocks.rows = [];
  mocks.lastArgs = null;
  vi.clearAllMocks();
  await cleanup();
});

describe("GET /admin/leaderboard — access control", () => {
  it("401s an unauthenticated caller", async () => {
    mocks.currentUser = null;
    const res = await request(app).get("/api/admin/leaderboard");
    expect(res.status).toBe(401);
  });

  it("403s a signed-in non-admin", async () => {
    const user = await createUser({ email: "not-admin@breakbpm.test" });
    mocks.currentUser = user;
    const res = await request(app).get("/api/admin/leaderboard");
    expect(res.status).toBe(403);
  });
});

describe("GET /admin/leaderboard — admin view", () => {
  it("returns rows with the hidden anti-cheat signals", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;
    mocks.rows = [
      adminRow({ rank: 1, screenName: "Cheater?", score: 55.5, trustedGames: 0, provisional: true }),
      adminRow({ rank: 2, screenName: "Legit", score: 50.1, trustedGames: 6, provisional: false }),
    ];

    const res = await request(app).get("/api/admin/leaderboard").query({ mode: "8ball", window: "all" });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("8ball");
    expect(res.body.window).toBe("all");
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows[0]).toMatchObject({
      screenName: "Cheater?",
      score: 55.5,
      trustedGames: 0,
      provisional: true,
    });
    expect(mocks.lastArgs).toEqual({ mode: "8ball", window: "all" });
  });

  it("passes the 9-ball mode through to the resolver", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;
    mocks.rows = [];

    const res = await request(app).get("/api/admin/leaderboard").query({ mode: "9ball", window: "30d" });

    expect(res.status).toBe(200);
    expect(mocks.lastArgs).toEqual({ mode: "9ball", window: "30d" });
  });

  it("400s an invalid mode", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;
    const res = await request(app).get("/api/admin/leaderboard").query({ mode: "snooker", window: "all" });
    expect(res.status).toBe(400);
  });
});
