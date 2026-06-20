import { describe, it, expect, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Regression guard for the summary-skip denominator. The bulk stats readers
// distill from each finished game's authoritative `summary`; a row whose summary
// is absent / a stale version is skipped ("absent not corrupt"). That skip must
// drop the row from BOTH the numerator AND the denominator — otherwise a single
// summaryless finished game inflates gamesPlayed / avg*PerGame while its own
// counts are omitted, skewing every per-game average. This matters most when a
// future summary-version bump leaves old rows stale before the backfill reruns.
//
// Personal scope is used deliberately: it filters to the caller's own
// participant rows, so the assertion is isolated from whatever else lives in the
// shared dev database (global scope would aggregate every game in the table).

// Authenticated caller — getOrCreateUser is overridden per-test to return the
// freshly-seeded user so the route resolves personal (account-tier) stats.
vi.mock("../lib/auth", () => ({
  getOrCreateUser: vi.fn(async () => null),
  getVerifiedSubject: vi.fn(async () => null),
}));

import gamesRouter from "./games";
import { getOrCreateUser } from "../lib/auth";
import { clearUserStatsCache } from "../lib/stats";
import { createUser, seedGame, finalizeSeededGame, cleanup } from "../test/factories";
import type { User } from "@workspace/db";

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

/**
 * Seed a finished 8-ball game hosted by `user` in which they sink `sinks` balls
 * over ~`sinks` × 20s, ending ~1h ago (inside the free 24h window). `finalize`
 * controls whether the authoritative summaries get written: an un-finalized game
 * keeps the default empty `{}` summary, exactly like a row whose summary write
 * was missed or whose version went stale.
 */
async function seedFinishedGame(
  user: User,
  sinks: number,
  finalize: boolean,
): Promise<void> {
  const base = Date.now() - 60 * 60 * 1000;
  const log = Array.from({ length: sinks }, (_, i) => ({
    type: "sink",
    playerName: user.screenName,
    ball: i + 1,
    timestamp: base + i * 20_000,
  }));
  const g = await seedGame(user.id, {
    gameType: "8ball",
    hostName: user.screenName,
    shotLog: log,
    startedAt: new Date(base),
    endedAt: new Date(base + 120_000),
    winner: user.screenName,
  });
  if (finalize) await finalizeSeededGame(g.id);
}

afterEach(async () => {
  vi.clearAllMocks();
  await cleanup();
});

describe("GET /stats — summaryless rows are absent, not corrupting", () => {
  it("excludes a finished game with an empty summary from gamesPlayed and per-game averages", async () => {
    const user = await createUser();
    vi.mocked(getOrCreateUser).mockResolvedValue(user);

    // One fully-finalized game (4 shots, valid summaries) and one finished game
    // whose summary write never happened (stays `{}`). Both are completed 8-ball
    // games the user hosted, so both fall inside the personal-stats SQL window.
    await seedFinishedGame(user, 4, true);
    await seedFinishedGame(user, 2, false);
    clearUserStatsCache(user.id);

    const res = await request(app)
      .get("/api/stats")
      .set("X-Forwarded-For", freshIp())
      .query({ scope: "personal" });

    expect(res.status).toBe(200);
    expect(res.body.appliedScope).toBe("personal");
    // Only the finalized game counts: the summaryless one is omitted entirely.
    expect(res.body.gamesPlayed).toBe(1);
    // 4 shots over 1 aggregated game — NOT 4 / 2 = 2 (the pre-fix dilution where
    // the summaryless row stayed in the denominator).
    expect(res.body.avgShotsPerGame).toBe(4);
  });
});
