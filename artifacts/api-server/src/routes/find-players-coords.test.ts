import { describe, it, expect, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Mutable test state shared with the module mocks (see admin-codes.test.ts).
const mocks = vi.hoisted(() => ({
  currentUser: null as { id: string } | null,
}));

vi.mock("../lib/auth", () => ({
  getVerifiedSubject: vi.fn(async () => mocks.currentUser),
  getOrCreateUser: vi.fn(async () => mocks.currentUser),
  needsOnboarding: vi.fn(() => false),
}));

import findPlayersRouter from "./findPlayers";
import { createUser, seedPass, seedFindPlayerPost, cleanup } from "../test/factories";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = { info() {}, warn() {}, error() {} };
    next();
  });
  app.use("/api", findPlayersRouter);
  return app;
}

const app = makeApp();

afterEach(async () => {
  mocks.currentUser = null;
  vi.clearAllMocks();
  await cleanup();
});

/** Find a post in the list response by id. */
function findPost(body: { posts: Array<{ id: string }> }, id: string) {
  return body.posts.find((p) => p.id === id);
}

describe("GET /find-players/posts — precise-coordinate gating (security)", () => {
  it("WITHHOLDS exact coords from a free (no-pass) caller for OTHERS' posts", async () => {
    const poster = await createUser({ email: "poster@breakbpm.test" });
    const post = await seedFindPlayerPost(poster.id, {
      latitude: 34.0522,
      longitude: -118.2437,
      locationLabel: "Los Angeles, United States",
    });

    const free = await createUser({ email: "free@breakbpm.test" });
    mocks.currentUser = free;

    const res = await request(app).get("/api/find-players/posts?all=true");
    expect(res.status).toBe(200);
    expect(res.body.preciseLocationsVisible).toBe(false);

    const card = findPost(res.body, post.id)!;
    expect(card.latitude).toBeNull();
    expect(card.longitude).toBeNull();
    // Coarse locality label is still shown so free users see the city.
    expect(card.locationLabel).toBe("Los Angeles, United States");
    expect(card.isOwn).toBe(false);
  });

  it("DISCLOSES exact coords to a paid caller for others' posts", async () => {
    const poster = await createUser({ email: "poster2@breakbpm.test" });
    const post = await seedFindPlayerPost(poster.id, {
      latitude: 40.7128,
      longitude: -74.006,
    });

    const paid = await createUser({ email: "paid@breakbpm.test" });
    await seedPass(paid.id, "lifetime");
    mocks.currentUser = paid;

    const res = await request(app).get("/api/find-players/posts?all=true");
    expect(res.status).toBe(200);
    expect(res.body.preciseLocationsVisible).toBe(true);

    const card = findPost(res.body, post.id)!;
    expect(card.latitude).toBeCloseTo(40.7128, 4);
    expect(card.longitude).toBeCloseTo(-74.006, 4);
  });

  it("ALWAYS discloses exact coords to the OWNER even when free", async () => {
    const owner = await createUser({ email: "owner@breakbpm.test" });
    const post = await seedFindPlayerPost(owner.id, {
      latitude: 51.5074,
      longitude: -0.1278,
    });
    mocks.currentUser = owner;

    const res = await request(app).get("/api/find-players/posts?all=true");
    expect(res.status).toBe(200);
    // The owner is free → flag false, but their own post still carries coords.
    expect(res.body.preciseLocationsVisible).toBe(false);

    const card = findPost(res.body, post.id)!;
    expect(card.isOwn).toBe(true);
    expect(card.latitude).toBeCloseTo(51.5074, 4);
    expect(card.longitude).toBeCloseTo(-0.1278, 4);
  });

  it("reports preciseLocationsVisible:false for signed-out callers", async () => {
    mocks.currentUser = null;
    const res = await request(app).get("/api/find-players/posts?all=true");
    expect(res.status).toBe(200);
    expect(res.body.signedIn).toBe(false);
    expect(res.body.preciseLocationsVisible).toBe(false);
  });
});
