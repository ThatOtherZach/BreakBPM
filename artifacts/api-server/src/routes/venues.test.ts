import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Mutable test state shared with the module mocks (see admin-codes.test.ts).
const mocks = vi.hoisted(() => ({
  currentUser: null as { id: string } | null,
  geocodeAddress: vi.fn(),
}));

// Stub auth: the venue handlers only call getOrCreateUser. Return whichever
// user the current test seeded, bypassing Clerk.
vi.mock("../lib/auth", () => ({
  getVerifiedSubject: vi.fn(async () => mocks.currentUser),
  getOrCreateUser: vi.fn(async () => mocks.currentUser),
  needsOnboarding: vi.fn(() => false),
}));

// Stub the network geocoder only — keep the real haversineMeters so the repair
// route's drift math is exercised for real. Each test sets the resolved value.
vi.mock("../lib/geocode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/geocode")>();
  return { ...actual, geocodeAddress: mocks.geocodeAddress };
});

import venuesRouter from "./venues";
import { createUser, seedVenue, seedGame, getVenue, cleanup } from "../test/factories";

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

describe("address is authoritative on create/update", () => {
  it("create geocodes the address and stores those coords, not the submitted lat/lng", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;
    mocks.geocodeAddress.mockResolvedValue({ lat: 43.6532, lng: -79.3832 });

    const res = await request(app).post("/api/admin/venues").send({
      name: "Address Hall",
      latitude: 1,
      longitude: 2,
      address: "100 Front St, Toronto",
    });

    expect(res.status).toBe(200);
    expect(mocks.geocodeAddress).toHaveBeenCalledTimes(1);
    const row = (await getVenue(res.body.venue.id))!;
    expect(row.latitude).toBeCloseTo(43.6532, 4);
    expect(row.longitude).toBeCloseTo(-79.3832, 4);
  });

  it("create keeps the submitted coords when the address can't be geocoded", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;
    mocks.geocodeAddress.mockResolvedValue(null);

    const res = await request(app).post("/api/admin/venues").send({
      name: "Unknown Address Hall",
      latitude: 12.34,
      longitude: 56.78,
      address: "Somewhere unfindable",
    });

    expect(res.status).toBe(200);
    const row = (await getVenue(res.body.venue.id))!;
    expect(row.latitude).toBeCloseTo(12.34, 4);
    expect(row.longitude).toBeCloseTo(56.78, 4);
  });

  it("create does NOT geocode when no address is provided", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;

    const res = await request(app).post("/api/admin/venues").send({
      name: "No Address Hall",
      latitude: 9.87,
      longitude: 6.54,
    });

    expect(res.status).toBe(200);
    expect(mocks.geocodeAddress).not.toHaveBeenCalled();
    const row = (await getVenue(res.body.venue.id))!;
    expect(row.latitude).toBeCloseTo(9.87, 4);
    expect(row.longitude).toBeCloseTo(6.54, 4);
  });

  it("update re-geocodes the address and overrides the submitted lat/lng", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    const venue = await seedVenue(admin.id, { name: "Drifted", latitude: 0, longitude: 0 });
    mocks.currentUser = admin;
    mocks.geocodeAddress.mockResolvedValue({ lat: 49.2827, lng: -123.1207 });

    const res = await request(app).patch(`/api/admin/venues/${venue.id}`).send({
      name: "Drifted",
      latitude: 0,
      longitude: 0,
      address: "Vancouver",
    });

    expect(res.status).toBe(200);
    const row = (await getVenue(venue.id))!;
    expect(row.latitude).toBeCloseTo(49.2827, 4);
    expect(row.longitude).toBeCloseTo(-123.1207, 4);
  });
});

describe("GET /venues/popular — most active halls by finalized game count", () => {
  it("returns an empty list for signed-out callers", async () => {
    mocks.currentUser = null;
    const res = await request(app).get("/api/venues/popular");
    expect(res.status).toBe(200);
    expect(res.body.venues).toEqual([]);
  });

  it("ranks active halls by finalized game count, ignores in-progress games, and excludes inactive halls", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    const a = await seedVenue(admin.id, { name: "Hall A", active: true });
    const b = await seedVenue(admin.id, { name: "Hall B", active: true });
    const c = await seedVenue(admin.id, { name: "Hall C", active: true });
    const inactive = await seedVenue(admin.id, { name: "Hall D", active: false });

    const ended = new Date();
    // Counts chosen to clearly dominate any unrelated active dev-DB hall so the
    // top-5 cap can't evict one of these. A: 4 finalized. C: 3 finalized + 1
    // in-progress (must NOT count). B: 2.
    for (let i = 0; i < 4; i++) await seedGame(admin.id, { venueId: a.id, endedAt: ended });
    for (let i = 0; i < 3; i++) await seedGame(admin.id, { venueId: c.id, endedAt: ended });
    await seedGame(admin.id, { venueId: c.id, endedAt: null });
    for (let i = 0; i < 2; i++) await seedGame(admin.id, { venueId: b.id, endedAt: ended });
    // The INACTIVE hall has the MOST finalized games but must never appear: the
    // active filter runs BEFORE ranking, so a deactivated hall is excluded even
    // when it outranks every active one.
    for (let i = 0; i < 7; i++) await seedGame(admin.id, { venueId: inactive.id, endedAt: ended });

    const user = await createUser({ email: "regular@breakbpm.test" });
    mocks.currentUser = user;

    const res = await request(app).get("/api/venues/popular");
    expect(res.status).toBe(200);
    const popular = res.body.venues as Array<{ venue: { id: string }; gameCount: number }>;

    // The endpoint ranks ALL halls globally and the shared dev DB may hold
    // unrelated venues/games, so assert only on the halls this test seeded.
    const mineIds = new Set([a.id, b.id, c.id, inactive.id]);
    const mine = popular.filter((p) => mineIds.has(p.venue.id));

    // Most active first; the in-progress game at C is not counted (C = 3, not 4).
    expect(mine.map((p) => p.venue.id)).toEqual([a.id, c.id, b.id]);
    const counts = new Map(mine.map((p) => [p.venue.id, p.gameCount]));
    expect(counts.get(a.id)).toBe(4);
    expect(counts.get(c.id)).toBe(3);
    expect(counts.get(b.id)).toBe(2);
    // The inactive hall never appears, despite having the highest count.
    expect(popular.some((p) => p.venue.id === inactive.id)).toBe(false);
  });

  it("caps the result at the top 5 halls", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    const ended = new Date();
    // Seed 7 active halls, each with a distinct finalized game count (7..1).
    // The counts dominate any unrelated dev-DB venue (which have far fewer
    // games), so this test's top 5 own the global ranking.
    const halls: Array<{ id: string; count: number }> = [];
    for (let rank = 7; rank >= 1; rank--) {
      const v = await seedVenue(admin.id, { name: `Hall ${rank}`, active: true });
      for (let i = 0; i < rank; i++) await seedGame(admin.id, { venueId: v.id, endedAt: ended });
      halls.push({ id: v.id, count: rank });
    }

    const user = await createUser({ email: "regular2@breakbpm.test" });
    mocks.currentUser = user;

    const res = await request(app).get("/api/venues/popular");
    expect(res.status).toBe(200);
    // The board is capped at 5 even though 7 halls qualify.
    expect(res.body.venues).toHaveLength(5);

    const returned = new Map(
      (res.body.venues as Array<{ venue: { id: string }; gameCount: number }>).map((p) => [
        p.venue.id,
        p.gameCount,
      ]),
    );
    // The 5 most-active halls appear with their counts, most-active first.
    expect(res.body.venues.map((p: { venue: { id: string } }) => p.venue.id)).toEqual(
      halls.slice(0, 5).map((h) => h.id),
    );
    for (const h of halls.slice(0, 5)) expect(returned.get(h.id)).toBe(h.count);
    // The two least-active halls (counts 2 and 1) are dropped by the cap.
    expect(returned.has(halls[5].id)).toBe(false);
    expect(returned.has(halls[6].id)).toBe(false);
  });
});

describe("POST /admin/venues/repair-coordinates", () => {
  it("403s a signed-in non-admin", async () => {
    const user = await createUser({ email: "not-admin@breakbpm.test" });
    mocks.currentUser = user;
    const res = await request(app).post("/api/admin/venues/repair-coordinates");
    expect(res.status).toBe(403);
  });

  it("401s a signed-out caller", async () => {
    mocks.currentUser = null;
    const res = await request(app).post("/api/admin/venues/repair-coordinates");
    expect(res.status).toBe(401);
  });

  it("moves a drifted pin, keeps a correct one, and reports no-address/geocode-fail as failed", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;

    // Drifted: stored far from where its address geocodes.
    const drifted = await seedVenue(admin.id, {
      name: "Drifted Hall",
      latitude: 0,
      longitude: 0,
      address: "Toronto",
    });
    // Correct: stored coords already match the geocode result.
    const correct = await seedVenue(admin.id, {
      name: "Correct Hall",
      latitude: 45.5019,
      longitude: -73.5674,
      address: "Montreal",
    });
    // No address: must be left untouched and reported as failed.
    const noAddr = await seedVenue(admin.id, {
      name: "No Address Hall",
      latitude: 10,
      longitude: 20,
      address: null,
    });
    // Unfindable address: geocode returns null → keep coords, report failed.
    const unfindable = await seedVenue(admin.id, {
      name: "Unfindable Hall",
      latitude: 30,
      longitude: 40,
      address: "nowhere at all",
    });

    mocks.geocodeAddress.mockImplementation(async (address: string) => {
      if (address === "Toronto") return { lat: 43.6532, lng: -79.3832 };
      if (address === "Montreal") return { lat: 45.5019, lng: -73.5674 };
      return null;
    });

    const res = await request(app).post("/api/admin/venues/repair-coordinates");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // The repair endpoint processes ALL venues, and the shared dev DB may hold
    // unrelated halls, so keep the aggregate totals tolerant and rely on the
    // per-item statuses below for this test's seeded venues. (Unrelated halls
    // fail to geocode under the stubbed geocoder, so they only add to `failed`.)
    expect(res.body.total).toBeGreaterThanOrEqual(4);
    expect(res.body.updated).toBeGreaterThanOrEqual(1);
    expect(res.body.unchanged).toBeGreaterThanOrEqual(1);
    expect(res.body.failed).toBeGreaterThanOrEqual(2);
    expect(res.body.total).toBe(res.body.updated + res.body.unchanged + res.body.failed);

    // The drifted pin actually moved to the geocoded point.
    const driftedRow = (await getVenue(drifted.id))!;
    expect(driftedRow.latitude).toBeCloseTo(43.6532, 4);
    expect(driftedRow.longitude).toBeCloseTo(-79.3832, 4);

    // The correct pin stayed put.
    const correctRow = (await getVenue(correct.id))!;
    expect(correctRow.latitude).toBeCloseTo(45.5019, 4);
    expect(correctRow.longitude).toBeCloseTo(-73.5674, 4);

    // The no-address and unfindable pins were NOT overwritten.
    const noAddrRow = (await getVenue(noAddr.id))!;
    expect(noAddrRow.latitude).toBeCloseTo(10, 4);
    expect(noAddrRow.longitude).toBeCloseTo(20, 4);
    const unfindableRow = (await getVenue(unfindable.id))!;
    expect(unfindableRow.latitude).toBeCloseTo(30, 4);
    expect(unfindableRow.longitude).toBeCloseTo(40, 4);

    const byId = new Map(
      res.body.items.map((i: { id: string; status: string }) => [i.id, i.status]),
    );
    expect(byId.get(drifted.id)).toBe("updated");
    expect(byId.get(correct.id)).toBe("unchanged");
    expect(byId.get(noAddr.id)).toBe("failed");
    expect(byId.get(unfindable.id)).toBe("failed");
  });
});
