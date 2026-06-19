import { describe, it, expect, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, gamesTable } from "@workspace/db";

// The public GET /leaderboard route is anonymous-friendly (30d window). These
// tests pin the mode-parameter wiring: an omitted `mode` defaults to 8-ball and
// is echoed back, and public rows never leak the admin-only anti-cheat signals.

// Anonymous caller — getOrCreateUser returns null, so computeEntitlement yields
// the public tier (30d window allowed). No Clerk involvement.
vi.mock("../lib/auth", () => ({
  getOrCreateUser: vi.fn(async () => null),
  getVerifiedSubject: vi.fn(async () => null),
}));

import gamesRouter from "./games";
import { clearLeaderboardCache } from "../lib/stats";
import { createUser, seedGame, seedParticipant, cleanup } from "../test/factories";

function makeApp(): Express {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = { info() {}, warn() {}, error() {} };
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

/** Seed a qualifying 8-ball 1-on-1 game where `host` sinks 4 balls in ~1 min. */
async function seedQualifyingGame(hostId: string, hostName: string): Promise<void> {
  const base = Date.now() - 2 * 3_600_000;
  const log = [0, 1, 2, 3].map((i) => ({
    type: "sink",
    playerName: hostName,
    ball: i + 1,
    timestamp: base + i * 20_000,
  }));
  const g = await seedGame(hostId, {
    gameType: "8ball",
    maxPlayers: 2,
    hostName,
    shotLog: log,
    startedAt: new Date(base),
    endedAt: new Date(base + 120_000),
  });
  await db
    .update(gamesTable)
    .set({ gameState: { ...(g.gameState as Record<string, unknown>), ruleSet: "open-through-break" } })
    .where(eq(gamesTable.id, g.id));
  const opp = await createUser();
  await seedParticipant(g.id, 1, { userId: opp.id, displayName: `Opp_${opp.id.slice(0, 6)}` });
}

afterEach(async () => {
  clearLeaderboardCache();
  vi.clearAllMocks();
  await cleanup();
});

describe("GET /leaderboard — mode wiring", () => {
  it("defaults to 8-ball when mode is omitted and echoes it back", async () => {
    const host = await createUser();
    await seedQualifyingGame(host.id, host.screenName);
    await seedQualifyingGame(host.id, host.screenName);
    clearLeaderboardCache();

    const res = await request(app)
      .get("/api/leaderboard")
      .set("X-Forwarded-For", freshIp());

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("8ball");
  });

  it("never leaks the admin-only anti-cheat signals on public rows", async () => {
    const host = await createUser();
    await seedQualifyingGame(host.id, host.screenName);
    await seedQualifyingGame(host.id, host.screenName);
    clearLeaderboardCache();

    const res = await request(app)
      .get("/api/leaderboard")
      .set("X-Forwarded-For", freshIp())
      .query({ mode: "8ball", window: "30d" });

    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: { screenName: string }) => r.screenName === host.screenName);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("score");
    expect(row).not.toHaveProperty("trustedGames");
    expect(row).not.toHaveProperty("provisional");
  });
});
