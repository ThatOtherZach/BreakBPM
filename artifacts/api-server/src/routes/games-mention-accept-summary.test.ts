import { describe, it, expect, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Regression guard for the @mention-accept summary recovery.
//
// When a player accepts an @mention invite AFTER the game has already
// finalized, their participant slot is created post-finalization. The per-slot
// summaries were distilled once, at finalize — BEFORE that slot existed — so
// the accepted player's side was never recorded, and the bulk read paths treat
// the absent slot summary as "absent, not corrupt" and silently skip it,
// vanishing their stats/history/leaderboard for that game.
//
// The accept handler must, for an already-finalized game, re-distill the
// summaries (idempotent, recomputes every slot) so the newly-created slot gets
// a real, non-empty summary, and must bust the affected users' stats +
// leaderboard caches so the recovery shows immediately.

vi.mock("../lib/auth", () => ({
  getOrCreateUser: vi.fn(async () => null),
  getVerifiedSubject: vi.fn(async () => null),
}));

// Partial-mock the stats module so we can assert the accept path busts the
// caches, while leaving every other stats export (resolveStats, etc.) intact.
vi.mock("../lib/stats", async (importActual) => {
  const actual = await importActual<typeof import("../lib/stats")>();
  return {
    ...actual,
    clearUserStatsCache: vi.fn(actual.clearUserStatsCache),
    clearLeaderboardCache: vi.fn(actual.clearLeaderboardCache),
  };
});

import gamesRouter from "./games";
import { getOrCreateUser } from "../lib/auth";
import { clearUserStatsCache, clearLeaderboardCache } from "../lib/stats";
import { GAME_SUMMARY_VERSION } from "../lib/gameSummary";
import {
  db,
  gameMentionsTable,
  gamesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  createUser,
  seedGame,
  finalizeSeededGame,
  getParticipants,
  cleanup,
} from "../test/factories";

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

afterEach(async () => {
  vi.clearAllMocks();
  await cleanup();
});

describe("POST /mentions/:id/accept — summary recovery on a finalized game", () => {
  it("re-distills the newly-created slot's summary and busts caches", async () => {
    const host = await createUser();
    const guest = await createUser();

    // A finished 1-on-1 8-ball game. The mentioned player's shots are logged
    // under their screen name (exactly how the client pins a mentioned slot's
    // player name to the canonical screen name), so the distiller — which
    // filters STATS by displayName and HISTORY by players[slotIndex].name —
    // attributes them to slot 1.
    const base = Date.now() - 60 * 60 * 1000;
    const shotLog = [
      { type: "sink", playerName: host.screenName, ball: 1, timestamp: base + 10_000 },
      { type: "sink", playerName: guest.screenName, ball: 9, timestamp: base + 20_000 },
      { type: "sink", playerName: guest.screenName, ball: 10, timestamp: base + 40_000 },
      { type: "win", playerName: guest.screenName, ball: 8, timestamp: base + 60_000 },
    ];
    const game = await seedGame(host.id, {
      gameType: "8ball",
      hostName: host.screenName,
      shotLog,
      startedAt: new Date(base),
      endedAt: new Date(base + 90_000),
      winner: guest.screenName,
    });
    // Give the game a real players array so the distiller's slot lookups work
    // (seedGame's default gameState omits it).
    await db
      .update(gamesTable)
      .set({
        gameState: {
          gameType: "8ball",
          startedAt: new Date(base).toISOString(),
          shareCode: game.shareCode,
          shotLog,
          players: [
            { name: host.screenName },
            { name: guest.screenName },
          ],
        },
      })
      .where(eq(gamesTable.id, game.id));

    // Finalize BEFORE the mentioned player accepts — this mirrors production:
    // the per-slot summaries are written while only the host slot exists.
    await finalizeSeededGame(game.id);

    // Only the host slot exists (and only it carries a summary).
    const before = await getParticipants(game.id);
    expect(before).toHaveLength(1);
    expect(before[0].slotIndex).toBe(0);

    // A pending @mention for the guest against slot 1 of the finished game.
    const mentionId = randomBytes(16).toString("hex");
    await db.insert(gameMentionsTable).values({
      id: mentionId,
      gameId: game.id,
      invitedUserId: guest.id,
      invitedByUserId: host.id,
      slotIndex: 1,
      displayName: guest.screenName,
      status: "pending",
    });

    vi.mocked(getOrCreateUser).mockResolvedValue(guest);

    const res = await request(app)
      .post(`/api/mentions/${mentionId}/accept`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);
    expect(res.body.gameId).toBe(game.id);

    // The mention is now accepted.
    const [mention] = await db
      .select()
      .from(gameMentionsTable)
      .where(eq(gameMentionsTable.id, mentionId));
    expect(mention.status).toBe("accepted");

    // The guest's participant slot now exists AND carries a real, current-
    // version summary with their pocketed balls counted (not an empty zero row).
    const after = await getParticipants(game.id);
    const guestSlot = after.find((p) => p.slotIndex === 1);
    expect(guestSlot).toBeDefined();
    expect(guestSlot?.userId).toBe(guest.id);
    const summary = guestSlot?.summary as {
      v?: number;
      made?: number;
      attempts?: number;
    } | null;
    expect(summary?.v).toBe(GAME_SUMMARY_VERSION);
    // Guest pocketed 3 balls (two sinks + the winning 8) — a meaningful row.
    expect(summary?.made).toBeGreaterThan(0);
    expect(summary?.attempts).toBeGreaterThan(0);

    // The host slot's summary is untouched (idempotent re-distill).
    const hostSlot = after.find((p) => p.slotIndex === 0);
    expect((hostSlot?.summary as { v?: number } | null)?.v).toBe(GAME_SUMMARY_VERSION);

    // Both affected users' stats caches were busted, and the leaderboard cache.
    const cleared = vi.mocked(clearUserStatsCache).mock.calls.map((c) => c[0]);
    expect(cleared).toContain(guest.id);
    expect(cleared).toContain(host.id);
    expect(vi.mocked(clearLeaderboardCache)).toHaveBeenCalled();
  });
});
