import { describe, it, expect, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Regression guards for how the personal-stats denominator (gamesPlayed) treats
// COMPLETED games — only completed games (endedAt set) count; in-progress games
// are already excluded by SQL. Two distinct completed-but-unsummarized cases:
//
//   1. A completed game whose summary write was simply MISSED (the column is
//      still the default `{}`). The /stats read path self-heals these
//      (`backfillUserGameSummaries`, keyed on `summary = '{}'`) BEFORE computing,
//      so they get a real summary and DO count. Net: every completed game the
//      player hosted/joined is counted.
//
//   2. A completed game carrying a STALE summary version (e.g. left over after a
//      `GAME_SUMMARY_VERSION` bump, before the one-time backfill reruns). The
//      self-heal does NOT touch these (it matches only `{}`), so the bulk readers
//      skip them ("absent not corrupt"). That skip must drop the row from BOTH
//      the numerator AND the denominator, so it temporarily under-reports rather
//      than mis-averaging — never inflating gamesPlayed / avg*PerGame.
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
import { createUser, seedGame, finalizeSeededGame, setStaleSummary, cleanup } from "../test/factories";
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
 * was missed. Returns the game id so the caller can age its summary further
 * (e.g. force a stale version that the read-path self-heal won't repair).
 */
async function seedFinishedGame(
  user: User,
  sinks: number,
  finalize: boolean,
): Promise<string> {
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
  return g.id;
}

afterEach(async () => {
  vi.clearAllMocks();
  await cleanup();
});

describe("GET /stats — completed-game counting", () => {
  it("self-heals a completed game whose summary write was missed, so it still counts", async () => {
    const user = await createUser();
    vi.mocked(getOrCreateUser).mockResolvedValue(user);

    // Two completed 8-ball games the user hosted: one fully finalized (4 shots),
    // one whose summary write never happened (stays `{}`, 2 shots). The /stats
    // read path self-heals the `{}` row before computing, so BOTH count — a
    // completed game is never silently dropped just because its summary lagged.
    await seedFinishedGame(user, 4, true);
    await seedFinishedGame(user, 2, false);
    clearUserStatsCache(user.id);

    const res = await request(app)
      .get("/api/stats")
      .set("X-Forwarded-For", freshIp())
      .query({ scope: "personal" });

    expect(res.status).toBe(200);
    expect(res.body.appliedScope).toBe("personal");
    // Both completed games count: the missed-summary one was self-healed.
    expect(res.body.gamesPlayed).toBe(2);
    // 6 shots (4 + 2) over 2 games.
    expect(res.body.avgShotsPerGame).toBe(3);
  });

  it("drops a completed game with a stale summary version from BOTH numerator and denominator", async () => {
    const user = await createUser();
    vi.mocked(getOrCreateUser).mockResolvedValue(user);

    // One fully-finalized game (4 shots) and one completed game left on a STALE
    // summary version — the self-heal (which matches only `{}`) won't repair it,
    // so the bulk readers skip it ("absent not corrupt").
    await seedFinishedGame(user, 4, true);
    const stale = await seedFinishedGame(user, 2, false);
    await setStaleSummary(stale);
    clearUserStatsCache(user.id);

    const res = await request(app)
      .get("/api/stats")
      .set("X-Forwarded-For", freshIp())
      .query({ scope: "personal" });

    expect(res.status).toBe(200);
    expect(res.body.appliedScope).toBe("personal");
    // Only the finalized game counts: the stale-version row is omitted entirely.
    expect(res.body.gamesPlayed).toBe(1);
    // 4 shots over 1 aggregated game — NOT 4 / 2 = 2 (the dilution where the
    // skipped row wrongly stayed in the denominator).
    expect(res.body.avgShotsPerGame).toBe(4);
  });
});
