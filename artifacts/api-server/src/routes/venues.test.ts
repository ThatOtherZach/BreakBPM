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
    expect(res.body.total).toBe(4);
    expect(res.body.updated).toBe(1);
    expect(res.body.unchanged).toBe(1);
    expect(res.body.failed).toBe(2);

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
