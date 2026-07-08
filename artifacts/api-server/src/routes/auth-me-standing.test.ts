import { describe, it, expect, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import type { LeaderboardRow } from "../lib/stats";

// /auth/me attaches the caller's OWN all-time global standing (a LeaderboardRow)
// so the Account Identity card can render like a leaderboard row with a global
// rank. It reuses the cached all-time ranking and keys the caller's row by
// canonical screenName. These tests pin that wiring: present when the caller is
// in the ranking, omitted when they're not, and never for signed-out callers.

const mocks = vi.hoisted(() => ({
  currentUser: null as
    | { id: string; screenName: string; email: string | null; profileTheme: string | null }
    | null,
  ranking: [] as LeaderboardRow[],
}));

vi.mock("../lib/auth", () => ({
  getVerifiedSubject: vi.fn(async () =>
    mocks.currentUser ? { provider: "test", subject: mocks.currentUser.id } : null,
  ),
  getOrCreateUser: vi.fn(async () => mocks.currentUser),
  needsOnboarding: vi.fn(() => false),
}));

vi.mock("../lib/stats", () => ({
  resolveLeaderboard: vi.fn(async () => mocks.ranking),
  clearLeaderboardCache: vi.fn(() => {}),
  countEightBallWinsToday: vi.fn(async () => 0),
  // /auth/me also resolves the caller's all-time personal stats to populate
  // the account's Defense fields (defenseRate/successes/safeties).
  resolveStats: vi.fn(async () => ({
    core: { defenseRate: 10, defenseSuccesses: 1, defenseSafeties: 2, defenseShots: 10 },
    cached: true,
  })),
}));

import authRouter from "./auth";
import { createUser, cleanup } from "../test/factories";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = { info() {}, warn() {}, error() {} };
    next();
  });
  app.use("/api", authRouter);
  return app;
}

const app = makeApp();

function row(over: Partial<LeaderboardRow> & Pick<LeaderboardRow, "rank" | "screenName">): LeaderboardRow {
  return {
    bpm: 40,
    accuracy: 80,
    gamesPlayed: 5,
    sharkLevel: 0,
    profileBackground: null,
    winsToday: 0,
    rainbowName: false,
    defenseRate: null,
    defenseSuccesses: 0,
    defenseSafeties: 0,
    defenseShots: 0,
    ...over,
  };
}

afterEach(async () => {
  mocks.currentUser = null;
  mocks.ranking = [];
  vi.clearAllMocks();
  await cleanup();
});

describe("/auth/me global standing", () => {
  it("includes globalStanding when the caller is in the all-time ranking", async () => {
    const user = await createUser();
    mocks.currentUser = { ...user, profileTheme: user.profileTheme ?? null };
    mocks.ranking = [
      row({ rank: 1, screenName: "SomeoneElse", bpm: 99 }),
      row({
        rank: 7,
        screenName: user.screenName,
        bpm: 42.5,
        accuracy: 88,
        sharkLevel: 3,
        defenseRate: 15,
        defenseSuccesses: 3,
        defenseSafeties: 4,
        defenseShots: 20,
      }),
    ];

    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.signedIn).toBe(true);
    expect(res.body.globalStanding).toBeTruthy();
    expect(res.body.globalStanding.rank).toBe(7);
    expect(res.body.globalStanding.bpm).toBe(42.5);
    expect(res.body.globalStanding.accuracy).toBe(88);
    expect(res.body.globalStanding.sharkLevel).toBe(3);
    // The standing row carries the WINDOW defense fields (drives the DEF chip).
    expect(res.body.globalStanding.defenseRate).toBe(15);
    expect(res.body.globalStanding.defenseSuccesses).toBe(3);
    expect(res.body.globalStanding.defenseSafeties).toBe(4);
    expect(res.body.globalStanding.defenseShots).toBe(20);
    // Account carries the all-time Defense numbers for the identity chip row.
    expect(res.body.account.defenseRate).toBe(10);
    expect(res.body.account.defenseSuccesses).toBe(1);
    expect(res.body.account.defenseSafeties).toBe(2);
    expect(res.body.account.defenseShots).toBe(10);
  });

  it("omits globalStanding when the caller is not ranked", async () => {
    const user = await createUser();
    mocks.currentUser = { ...user, profileTheme: user.profileTheme ?? null };
    mocks.ranking = [row({ rank: 1, screenName: "SomeoneElse" })];

    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.signedIn).toBe(true);
    expect(res.body.globalStanding).toBeUndefined();
  });

  it("never includes globalStanding for signed-out callers", async () => {
    mocks.currentUser = null;

    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.signedIn).toBe(false);
    expect(res.body.globalStanding).toBeUndefined();
  });
});
