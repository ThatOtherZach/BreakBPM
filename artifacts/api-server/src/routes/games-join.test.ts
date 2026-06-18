import { describe, it, expect, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Mutable test state shared with the module mocks. Declared via vi.hoisted so
// it is initialised before the (hoisted) vi.mock factories run.
const mocks = vi.hoisted(() => ({
  currentUser: null as { id: string; screenName: string } | null,
  // Registry of seeded users keyed by id, so a request can identify itself via
  // an `x-test-user` header. This lets CONCURRENT requests each carry a stable,
  // distinct user even though they share the module-level mock — essential for
  // the slot-allocation race where six users join at once.
  users: new Map<string, { id: string; screenName: string }>(),
}));

// Stub auth: the join/leave handlers call getOrCreateUser (and start/save call
// getVerifiedSubject). Identity comes from the `x-test-user` request header
// when present (per-request, concurrency-safe), else the module-level
// currentUser, else null (anonymous) — bypassing Clerk entirely.
vi.mock("../lib/auth", () => {
  const resolve = (req: unknown): { id: string; screenName: string } | null => {
    const id = (req as { headers?: Record<string, string> })?.headers?.["x-test-user"];
    if (id && mocks.users.has(id)) return mocks.users.get(id)!;
    return mocks.currentUser;
  };
  return {
    getOrCreateUser: vi.fn(async (req: unknown) => resolve(req)),
    getVerifiedSubject: vi.fn(async (req: unknown) => {
      const u = resolve(req);
      return u ? { provider: "test", subject: u.id } : null;
    }),
  };
});

import gamesRouter from "./games";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  createUser,
  seedPass,
  seedGame,
  seedParticipant,
  getGame,
  getParticipants,
  cleanup,
} from "../test/factories";

function makeApp(): Express {
  const app = express();
  // Trust the proxy header so each test can present a distinct client IP via
  // X-Forwarded-For. The share-code endpoints rate-limit per IP using an
  // in-memory bucket that persists for the whole process, so isolating IPs
  // keeps one test's requests from exhausting another test's budget.
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

/** Unique source IP per test → its own rate-limit bucket. */
function freshIp(): string {
  const o = () => Math.floor(Math.random() * 254) + 1;
  return `10.${o()}.${o()}.${o()}`;
}

afterEach(async () => {
  mocks.currentUser = null;
  mocks.users.clear();
  vi.clearAllMocks();
  await cleanup();
});

describe("POST /games/resolve", () => {
  it("returns metadata for an open game", async () => {
    const host = await createUser();
    const game = await seedGame(host.id, { maxPlayers: 2, hostName: "Hosty" });

    const res = await request(app)
      .post("/api/games/resolve")
      .set("X-Forwarded-For", freshIp())
      .send({ code: game.shareCode });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.gameId).toBe(game.id);
    expect(res.body.maxPlayers).toBe(2);
    expect(res.body.filledSlots).toBe(1); // host occupies slot 0
    expect(res.body.hostName).toBe("Hosty");
    expect(res.body.soloMode).toBe(false);
  });

  it("reports not_found for an unknown code", async () => {
    const res = await request(app)
      .post("/api/games/resolve")
      .set("X-Forwarded-For", freshIp())
      .send({ code: "ZZZZZ" });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
    expect(res.body.reason).toBe("not_found");
  });

  it("reports ended for a finished game", async () => {
    const host = await createUser();
    const game = await seedGame(host.id, { endedAt: new Date() });

    const res = await request(app)
      .post("/api/games/resolve")
      .set("X-Forwarded-For", freshIp())
      .send({ code: game.shareCode });

    expect(res.body.found).toBe(false);
    expect(res.body.reason).toBe("ended");
  });

  it("rate-limits a single IP after the per-minute cap", async () => {
    const host = await createUser();
    const game = await seedGame(host.id);
    const ip = freshIp();

    // The cap is 60 requests / minute / IP. Fire 60 (all allowed), then the
    // 61st from the SAME IP must be throttled.
    let lastOk = 0;
    for (let i = 0; i < 60; i++) {
      const r = await request(app)
        .post("/api/games/resolve")
        .set("X-Forwarded-For", ip)
        .send({ code: game.shareCode });
      if (r.status === 200 && r.body.found) lastOk++;
    }
    expect(lastOk).toBe(60);

    const limited = await request(app)
      .post("/api/games/resolve")
      .set("X-Forwarded-For", ip)
      .send({ code: game.shareCode });
    expect(limited.status).toBe(429);
    expect(limited.body.found).toBe(false);
    expect(limited.body.reason).toBe("rate_limited");
  });
});

describe("POST /games/join — slot allocation", () => {
  it("allocates distinct slots under concurrent joins (no double-booking)", async () => {
    const host = await createUser();
    // Paid host so losers fall back to spectator rather than being rejected.
    await seedPass(host.id, "lifetime");
    const game = await seedGame(host.id, { maxPlayers: 4 }); // slots 1,2,3 open

    // Six signed-in users race for three open slots. Each request identifies
    // itself via the `x-test-user` header (resolved per-request by the auth
    // mock), so firing them concurrently exercises the real slot-allocation
    // race (FOR UPDATE re-read + unique-slot insert) rather than colliding on
    // a shared module-level user.
    const joiners = await Promise.all(
      Array.from({ length: 6 }, () => createUser()),
    );
    for (const u of joiners) mocks.users.set(u.id, u);

    const results = await Promise.all(
      joiners.map((u) =>
        request(app)
          .post("/api/games/join")
          .set("X-Forwarded-For", freshIp())
          .set("x-test-user", u.id)
          .send({ code: game.shareCode }),
      ),
    );

    const players = results.filter((r) => r.body.role === "player");
    const slots = players.map((r) => r.body.slotIndex).sort();
    expect(players).toHaveLength(3);
    expect(slots).toEqual([1, 2, 3]);
    // No duplicate slots.
    expect(new Set(slots).size).toBe(3);

    // Everyone else became a spectator (paid host).
    const spectators = results.filter((r) => r.body.role === "spectator");
    expect(spectators).toHaveLength(3);

    // DB reflects exactly 4 active participants (host + 3 players).
    const parts = await getParticipants(game.id);
    expect(parts.filter((p) => p.leftAt === null)).toHaveLength(4);
  });

  it("falls back to spectator when the game is full (paid host)", async () => {
    const host = await createUser();
    await seedPass(host.id, "lifetime");
    const game = await seedGame(host.id, { maxPlayers: 2 });
    await seedParticipant(game.id, 1, { displayName: "Seat1" }); // now full

    const joiner = await createUser();
    const res = await joinAs(joiner, game.shareCode);

    expect(res.body.joined).toBe(true);
    expect(res.body.role).toBe("spectator");
    expect(res.body.slotIndex).toBeNull();
    expect(res.body.reason).toBe("full");
  });

  it("rejects watching a full game when the host is unpaid", async () => {
    const host = await createUser(); // no pass
    const game = await seedGame(host.id, { maxPlayers: 2 });
    await seedParticipant(game.id, 1, { displayName: "Seat1" });

    const joiner = await createUser();
    const res = await joinAs(joiner, game.shareCode);

    expect(res.body.joined).toBe(false);
    expect(res.body.reason).toBe("spectators_disabled");
  });

  it("short-circuits when the host joins their own code", async () => {
    const host = await createUser();
    const game = await seedGame(host.id, { maxPlayers: 2, hostName: host.screenName });

    const res = await joinAs(host, game.shareCode);

    expect(res.body.joined).toBe(true);
    expect(res.body.role).toBe("already_joined");
    expect(res.body.reason).toBe("host");
    expect(res.body.slotIndex).toBe(0);

    // No extra participant rows created.
    const parts = await getParticipants(game.id);
    expect(parts).toHaveLength(1);
  });

  it("is idempotent for a signed-in joiner who already holds a slot", async () => {
    const host = await createUser();
    const game = await seedGame(host.id, { maxPlayers: 2 });
    const joiner = await createUser();

    const first = await joinAs(joiner, game.shareCode);
    expect(first.body.role).toBe("player");
    expect(first.body.slotIndex).toBe(1);

    const again = await joinAs(joiner, game.shareCode);
    expect(again.body.role).toBe("already_joined");
    expect(again.body.slotIndex).toBe(1);

    // Still exactly one joiner row.
    const parts = await getParticipants(game.id);
    expect(parts.filter((p) => !p.isHost)).toHaveLength(1);
  });

  it("downgrades a late signed-in joiner to spectator once the break has happened (paid host)", async () => {
    const host = await createUser();
    await seedPass(host.id, "lifetime");
    const game = await seedGame(host.id, {
      maxPlayers: 2,
      shotLog: [{ type: "sink", ball: 3, playerName: "Host", timestamp: Date.now() }],
    });

    const joiner = await createUser();
    const res = await joinAs(joiner, game.shareCode);

    expect(res.body.role).toBe("spectator");
    expect(res.body.reason).toBe("in_progress");
    expect(res.body.slotIndex).toBeNull();
  });
});

describe("POST /games/leave — leave is a forfeit of the slot", () => {
  it("does not end the game while another participant remains", async () => {
    const host = await createUser();
    const game = await seedGame(host.id, { maxPlayers: 2 });
    const joiner = await createUser();
    await joinAs(joiner, game.shareCode); // joiner now in slot 1

    mocks.currentUser = joiner;
    const res = await request(app)
      .post("/api/games/leave")
      .send({ gameId: game.id });

    expect(res.body.left).toBe(true);
    expect(res.body.gameEnded).toBe(false);

    const refreshed = await getGame(game.id);
    expect(refreshed?.endedAt).toBeNull();

    // The leaver's slot stays reserved (leftAt set, not deleted).
    const parts = await getParticipants(game.id);
    const slot1 = parts.find((p) => p.slotIndex === 1);
    expect(slot1?.leftAt).not.toBeNull();
  });

  it("ends the game as a forfeit when the last participant leaves", async () => {
    const host = await createUser();
    const game = await seedGame(host.id, { maxPlayers: 2 });

    mocks.currentUser = host;
    const res = await request(app)
      .post("/api/games/leave")
      .send({ gameId: game.id });

    expect(res.body.left).toBe(true);
    expect(res.body.gameEnded).toBe(true);

    const refreshed = await getGame(game.id);
    expect(refreshed?.endedAt).not.toBeNull();
    expect(refreshed?.outcome).toBe("forfeit");
    const gs = refreshed?.gameState as { forfeitReason?: string };
    expect(gs.forfeitReason).toBe("all_left");
  });

  it("lets a guest leave via their guestToken", async () => {
    const host = await createUser();
    await seedPass(host.id, "lifetime");
    const game = await seedGame(host.id, { maxPlayers: 2 });

    // Anonymous guest joins for a real slot.
    mocks.currentUser = null;
    const join = await request(app)
      .post("/api/games/join")
      .set("X-Forwarded-For", freshIp())
      .send({ code: game.shareCode, guestName: "Guesty" });
    expect(join.body.role).toBe("player");
    const guestToken = join.body.guestToken as string;
    expect(guestToken).toBeTruthy();

    const res = await request(app)
      .post("/api/games/leave")
      .send({ gameId: game.id, guestToken });
    expect(res.body.left).toBe(true);

    const parts = await getParticipants(game.id);
    const guestRow = parts.find((p) => p.guestToken === guestToken);
    expect(guestRow?.leftAt).not.toBeNull();
  });

  it("requires auth or a guestToken to leave", async () => {
    const host = await createUser();
    const game = await seedGame(host.id, { maxPlayers: 2 });

    mocks.currentUser = null;
    const res = await request(app)
      .post("/api/games/leave")
      .send({ gameId: game.id });
    expect(res.status).toBe(401);
  });
});

describe("GET /games/state", () => {
  it("returns the live snapshot and participant roster by code", async () => {
    const host = await createUser();
    const game = await seedGame(host.id, { maxPlayers: 2, hostName: "Hosty" });
    await seedParticipant(game.id, 1, { displayName: "Seat1" });

    const res = await request(app)
      .get("/api/games/state")
      .set("X-Forwarded-For", freshIp())
      .query({ code: game.shareCode });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.gameId).toBe(game.id);
    expect(res.body.ended).toBe(false);
    expect(res.body.participants).toHaveLength(2);
    const host0 = res.body.participants.find(
      (p: { slotIndex: number }) => p.slotIndex === 0,
    );
    expect(host0.isHost).toBe(true);
    // A default ("auto") unpaid host carries no theme → spectators fall back
    // to the default green felt.
    expect(res.body.hostTheme).toBeNull();
  });

  it("carries the host's explicit theme override to spectators", async () => {
    const host = await createUser();
    await db
      .update(usersTable)
      .set({ profileTheme: "shark" })
      .where(eq(usersTable.id, host.id));
    const game = await seedGame(host.id, { maxPlayers: 2, hostName: "Hosty" });

    const res = await request(app)
      .get("/api/games/state")
      .set("X-Forwarded-For", freshIp())
      .query({ code: game.shareCode });

    expect(res.status).toBe(200);
    expect(res.body.hostTheme).toBe("shark");
  });
});

/**
 * Fire a /games/join as a specific signed-in user. Identity travels in the
 * `x-test-user` header (resolved per-request by the auth mock), so this is
 * safe to call concurrently with other users.
 */
async function joinAs(
  user: { id: string; screenName: string },
  code: string,
): Promise<request.Response> {
  mocks.users.set(user.id, user);
  return request(app)
    .post("/api/games/join")
    .set("X-Forwarded-For", freshIp())
    .set("x-test-user", user.id)
    .send({ code });
}
