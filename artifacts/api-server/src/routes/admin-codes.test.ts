import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Mutable test state shared with the module mocks. Declared via vi.hoisted so
// it is initialised before the (hoisted) vi.mock factories run.
const mocks = vi.hoisted(() => ({
  currentUser: null as { id: string } | null,
}));

// Stub auth: the route handlers only call getOrCreateUser. We return whichever
// user the current test seeded, bypassing Clerk entirely.
vi.mock("../lib/auth", () => ({
  getVerifiedSubject: vi.fn(async () => mocks.currentUser),
  getOrCreateUser: vi.fn(async () => mocks.currentUser),
  needsOnboarding: vi.fn(() => false),
}));

// passes.ts mirrors Lifetime grants to Stripe (best-effort). Stub the provider
// seam so the tests never touch the real connector.
vi.mock("../lib/paymentProvider", () => ({
  paymentProvider: {},
  stopRenewingStripeSubscriptions: vi.fn(async () => {}),
}));

import passesRouter from "./passes";
import authRouter from "./auth";
import { createUser, getDiscountCode, cleanup } from "../test/factories";

// A fixed email placed on the admin allowlist for the duration of this suite.
const ADMIN_EMAIL = "route-admin-test@breakbpm.test";
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
    (req as unknown as { log: unknown }).log = {
      info() {},
      warn() {},
      error() {},
    };
    next();
  });
  app.use("/api", passesRouter);
  app.use("/api", authRouter);
  return app;
}

const app = makeApp();

afterEach(async () => {
  mocks.currentUser = null;
  vi.clearAllMocks();
  await cleanup();
});

describe("admin code routes — non-admin rejection & admin happy path", () => {
  it("403s a signed-in non-admin on POST /passes/admin/codes", async () => {
    const user = await createUser({ email: "not-an-admin@breakbpm.test" });
    mocks.currentUser = user;

    const res = await request(app)
      .post("/api/passes/admin/codes")
      .send({ kind: "day" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admins only/i);
  });

  it("403s a signed-in non-admin on GET /passes/admin/codes", async () => {
    const user = await createUser({ email: "not-an-admin@breakbpm.test" });
    mocks.currentUser = user;

    const res = await request(app).get("/api/passes/admin/codes");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admins only/i);
  });

  it("403s a user with no email (anonymous-ish) on the admin routes", async () => {
    const user = await createUser();
    mocks.currentUser = user;

    const post = await request(app)
      .post("/api/passes/admin/codes")
      .send({ kind: "day" });
    const get = await request(app).get("/api/passes/admin/codes");

    expect(post.status).toBe(403);
    expect(get.status).toBe(403);
  });

  it("mints a code for an admin on POST and lists it back on GET", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;

    const post = await request(app)
      .post("/api/passes/admin/codes")
      .send({ kind: "month", maxRedemptions: 5 });

    expect(post.status).toBe(200);
    expect(post.body.code).toBeDefined();
    expect(post.body.code.code).toMatch(/^BB-/);
    expect(post.body.code.grantsPassKind).toBe("month");
    expect(post.body.code.maxRedemptions).toBe(5);
    expect(post.body.code.redemptionCount).toBe(0);

    // The minted row is persisted and tagged as an admin-issued code.
    const row = (await getDiscountCode(post.body.code.code))!;
    expect(row.issuedByUserId).toBe(admin.id);
    expect(row.issuerKind).toBe("admin");
    expect(row.expiresAt).toBeNull();

    const get = await request(app).get("/api/passes/admin/codes");
    expect(get.status).toBe(200);
    expect(Array.isArray(get.body.codes)).toBe(true);
    const listed = get.body.codes.find(
      (c: { code: string }) => c.code === post.body.code.code,
    );
    expect(listed).toBeDefined();
    expect(listed.grantsPassKind).toBe("month");
  });
});

describe("PATCH /auth/screen-name — admin-effective Lifetime perk", () => {
  it("403s a signed-in non-admin with no pass", async () => {
    const user = await createUser({ email: "not-an-admin@breakbpm.test" });
    mocks.currentUser = user;

    const res = await request(app)
      .patch("/api/auth/screen-name")
      .send({ screenName: "FreshHandle" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/lifetime/i);
  });

  it("lets an admin with no real pass set a custom screen name (200)", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;

    const newName = `Admin_${admin.id.slice(0, 6)}`;
    const res = await request(app)
      .patch("/api/auth/screen-name")
      .send({ screenName: newName });

    expect(res.status).toBe(200);
    expect(res.body.screenName).toBe(newName);
    expect(res.body.id).toBe(admin.id);
  });
});
