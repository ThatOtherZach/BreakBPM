import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Mutable test state shared with the module mocks (see admin-codes.test.ts).
const mocks = vi.hoisted(() => ({
  currentUser: null as { id: string } | null,
}));

// Stub auth: the venue handlers only call getOrCreateUser. Return whichever
// user the current test seeded, bypassing Clerk.
vi.mock("../lib/auth", () => ({
  getVerifiedSubject: vi.fn(async () => mocks.currentUser),
  getOrCreateUser: vi.fn(async () => mocks.currentUser),
  needsOnboarding: vi.fn(() => false),
}));

import venuesRouter from "./venues";
import { createUser, seedVenue, getVenue, cleanup } from "../test/factories";

const ADMIN_EMAIL = "venue-admin-test@breakbpm.test";
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
  app.use("/api", venuesRouter);
  return app;
}

const app = makeApp();

afterEach(async () => {
  mocks.currentUser = null;
  vi.clearAllMocks();
  await cleanup();
});

describe("GET /venues — public (signed-in) listing", () => {
  it("returns an empty list for signed-out callers", async () => {
    mocks.currentUser = null;
    const res = await request(app).get("/api/venues");
    expect(res.status).toBe(200);
    expect(res.body.venues).toEqual([]);
  });

  it("returns ONLY active venues to a signed-in caller", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    const active = await seedVenue(admin.id, { name: "Active Hall", active: true });
    const inactive = await seedVenue(admin.id, { name: "Inactive Hall", active: false });

    const user = await createUser({ email: "regular@breakbpm.test" });
    mocks.currentUser = user;

    const res = await request(app).get("/api/venues");
    expect(res.status).toBe(200);
    const ids = res.body.venues.map((v: { id: string }) => v.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
  });
});

describe("GET /admin/venues — admin-only full listing", () => {
  it("403s a signed-in non-admin", async () => {
    const user = await createUser({ email: "not-admin@breakbpm.test" });
    mocks.currentUser = user;
    const res = await request(app).get("/api/admin/venues");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admins only/i);
  });

  it("401s a signed-out caller", async () => {
    mocks.currentUser = null;
    const res = await request(app).get("/api/admin/venues");
    expect(res.status).toBe(401);
  });

  it("returns ALL venues (active + inactive) for an admin", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    const active = await seedVenue(admin.id, { active: true });
    const inactive = await seedVenue(admin.id, { active: false });
    mocks.currentUser = admin;

    const res = await request(app).get("/api/admin/venues");
    expect(res.status).toBe(200);
    const ids = res.body.venues.map((v: { id: string }) => v.id);
    expect(ids).toContain(active.id);
    expect(ids).toContain(inactive.id);
  });
});

describe("POST /admin/venues — create", () => {
  it("403s a signed-in non-admin", async () => {
    const user = await createUser({ email: "not-admin@breakbpm.test" });
    mocks.currentUser = user;
    const res = await request(app)
      .post("/api/admin/venues")
      .send({ name: "X", latitude: 1, longitude: 2 });
    expect(res.status).toBe(403);
  });

  it("403s a user with no email", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    const res = await request(app)
      .post("/api/admin/venues")
      .send({ name: "X", latitude: 1, longitude: 2 });
    expect(res.status).toBe(403);
  });

  it("creates a venue for an admin and persists it", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;

    const res = await request(app).post("/api/admin/venues").send({
      name: "Corner Pocket",
      latitude: 34.05,
      longitude: -118.24,
      locality: "Los Angeles",
      tableCount: 12,
      contact: "555-1234",
      active: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.venue.name).toBe("Corner Pocket");
    expect(res.body.venue.tableCount).toBe(12);
    expect(res.body.venue.active).toBe(true);

    const row = (await getVenue(res.body.venue.id))!;
    expect(row.name).toBe("Corner Pocket");
    expect(row.createdByUserId).toBe(admin.id);
  });

  it("rejects an invalid body (400)", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;
    const res = await request(app)
      .post("/api/admin/venues")
      .send({ name: "", latitude: 999, longitude: 2 });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /admin/venues/:id — update", () => {
  it("403s a non-admin", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    const venue = await seedVenue(admin.id);
    const user = await createUser({ email: "not-admin@breakbpm.test" });
    mocks.currentUser = user;
    const res = await request(app)
      .patch(`/api/admin/venues/${venue.id}`)
      .send({ name: "New", latitude: 1, longitude: 2 });
    expect(res.status).toBe(403);
  });

  it("updates an existing venue for an admin", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    const venue = await seedVenue(admin.id, { name: "Old", active: true });
    mocks.currentUser = admin;

    const res = await request(app).patch(`/api/admin/venues/${venue.id}`).send({
      name: "Renamed",
      latitude: 10,
      longitude: 20,
      active: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.venue.name).toBe("Renamed");
    expect(res.body.venue.active).toBe(false);

    const row = (await getVenue(venue.id))!;
    expect(row.name).toBe("Renamed");
    expect(row.active).toBe(false);
  });

  it("returns success:false reason:not_found for a missing id", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;
    const res = await request(app)
      .patch("/api/admin/venues/does-not-exist")
      .send({ name: "X", latitude: 1, longitude: 2 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.reason).toBe("not_found");
  });
});

describe("DELETE /admin/venues/:id — delete", () => {
  it("403s a non-admin", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    const venue = await seedVenue(admin.id);
    const user = await createUser({ email: "not-admin@breakbpm.test" });
    mocks.currentUser = user;
    const res = await request(app).delete(`/api/admin/venues/${venue.id}`);
    expect(res.status).toBe(403);
  });

  it("deletes an existing venue for an admin", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    const venue = await seedVenue(admin.id);
    mocks.currentUser = admin;

    const res = await request(app).delete(`/api/admin/venues/${venue.id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(await getVenue(venue.id)).toBeUndefined();
  });

  it("returns success:false reason:not_found for a missing id", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;
    const res = await request(app).delete("/api/admin/venues/does-not-exist");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.reason).toBe("not_found");
  });
});
