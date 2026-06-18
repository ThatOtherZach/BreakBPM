import { describe, it, expect, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// The history-card felt is the host's theme SNAPSHOTTED onto the game at
// /games/start and frozen for every later viewer. The snapshot lives in the
// game_state JSON under `hostTheme`; the danger is that /games/activity and
// /games/save replace the whole game_state blob with client-supplied state and
// would erase it. These tests drive the real routes and assert the snapshot is
// written at start and survives subsequent client writes (and that the client
// can never set it itself).

const mocks = vi.hoisted(() => ({
  // The full user object getOrCreateUser returns; the route reads .id, .email,
  // .screenName and .profileTheme off it. profileTheme drives the snapshot.
  currentUser: null as
    | { id: string; screenName: string; email: string | null; profileTheme: string | null }
    | null,
}));

vi.mock("../lib/auth", () => ({
  getOrCreateUser: vi.fn(async () => mocks.currentUser),
  getVerifiedSubject: vi.fn(async () =>
    mocks.currentUser ? { provider: "test", subject: mocks.currentUser.id } : null,
  ),
}));

import gamesRouter from "./games";
import { createUser, getGame, uniqueShareCode, cleanup } from "../test/factories";

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

/** Sign in as `host`, optionally overriding their stored profile theme. */
async function signInAs(theme: string | null): Promise<{ id: string; screenName: string }> {
  const host = await createUser();
  mocks.currentUser = { ...host, profileTheme: theme };
  return host;
}

/** Start a game as the current host; returns its server id + share code. */
async function startGame(): Promise<{ gameId: string; shareCode: string }> {
  const res = await request(app)
    .post("/api/games/start")
    .set("X-Forwarded-For", freshIp())
    .send({ gameType: "8ball" });
  expect(res.status).toBe(200);
  expect(res.body.gameId).toBeTruthy();
  return { gameId: res.body.gameId as string, shareCode: res.body.shareCode as string };
}

/** A minimal valid /games/save body finalizing a game. */
function saveBody(
  gameState: Record<string, unknown>,
  opts: { gameId?: string; shareCode?: string } = {},
): Record<string, unknown> {
  return {
    ...(opts.gameId ? { gameId: opts.gameId } : {}),
    shareCode: opts.shareCode ?? uniqueShareCode(),
    gameType: "8ball",
    durationMs: 1000,
    sunkBallsCount: 0,
    outcome: "completed",
    gameState,
    startedAt: new Date().toISOString(),
  };
}

/** Read back a game's stored game_state JSON. */
async function gameState(gameId: string): Promise<Record<string, unknown>> {
  const row = await getGame(gameId);
  expect(row).toBeTruthy();
  return row!.gameState as Record<string, unknown>;
}

afterEach(async () => {
  mocks.currentUser = null;
  vi.clearAllMocks();
  // Route-created games cascade-delete when their host user is removed.
  await cleanup();
});

describe("history-card host-theme snapshot", () => {
  it("snapshots the host's explicit theme onto the game at /games/start", async () => {
    await signInAs("shark");
    const { gameId } = await startGame();

    expect((await gameState(gameId)).hostTheme).toBe("shark");
  });

  it("stores NO hostTheme when the host has no theme (history → default green)", async () => {
    await signInAs(null);
    const { gameId } = await startGame();

    expect("hostTheme" in (await gameState(gameId))).toBe(false);
  });

  it("/games/activity preserves the snapshot when client state omits it", async () => {
    await signInAs("shark");
    const { gameId } = await startGame();

    const res = await request(app)
      .post("/api/games/activity")
      .set("X-Forwarded-For", freshIp())
      .send({ gameId, gameState: { shotLog: [], marker: "live" } });
    expect(res.status).toBe(200);
    expect(res.body.alive).toBe(true);

    const gs = await gameState(gameId);
    expect(gs.hostTheme).toBe("shark"); // snapshot survived the blob replace
    expect(gs.marker).toBe("live"); // client state still applied
  });

  it("/games/save (finalizing a started row) preserves the snapshot", async () => {
    await signInAs("shark");
    const { gameId, shareCode } = await startGame();

    const res = await request(app)
      .post("/api/games/save")
      .set("X-Forwarded-For", freshIp())
      .send(saveBody({ marker: "final" }, { gameId, shareCode }));
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);

    const row = await getGame(gameId);
    expect(row!.endedAt).not.toBeNull();
    const gs = row!.gameState as Record<string, unknown>;
    expect(gs.hostTheme).toBe("shark");
    expect(gs.marker).toBe("final");
  });

  it("/games/save with no started row (insert fallback) resolves the theme server-side", async () => {
    await signInAs("hustler");

    const res = await request(app)
      .post("/api/games/save")
      .set("X-Forwarded-For", freshIp())
      .send(saveBody({ marker: "fresh" }));
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
    expect(res.body.gameId).toBeTruthy();

    expect((await gameState(res.body.gameId as string)).hostTheme).toBe("hustler");
  });

  it("never trusts a client-supplied hostTheme — the server snapshot wins", async () => {
    await signInAs("shark");
    const { gameId, shareCode } = await startGame();

    const res = await request(app)
      .post("/api/games/save")
      .set("X-Forwarded-For", freshIp())
      .send(saveBody({ hostTheme: "hustler", marker: "spoof" }, { gameId, shareCode }));
    expect(res.status).toBe(200);

    expect((await gameState(gameId)).hostTheme).toBe("shark");
  });
});
