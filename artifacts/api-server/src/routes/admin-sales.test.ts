import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Mutable test state shared with the module mocks. Declared via vi.hoisted so
// it is initialised before the (hoisted) vi.mock factories run.
const mocks = vi.hoisted(() => ({
  currentUser: null as { id: string; email: string | null } | null,
}));

// Stub auth: the route only calls getOrCreateUser. Return whichever user the
// current test seeded, bypassing Clerk entirely.
vi.mock("../lib/auth", () => ({
  getOrCreateUser: vi.fn(async () => mocks.currentUser),
}));

import adminRouter from "./admin";
import { createUser, seedSaleEvent, cleanup } from "../test/factories";

// A fixed email placed on the admin allowlist for the duration of this suite.
const ADMIN_EMAIL = "sales-admin-test@breakbpm.test";
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
  app.use("/api", adminRouter);
  return app;
}

const app = makeApp();

afterEach(async () => {
  mocks.currentUser = null;
  vi.clearAllMocks();
  await cleanup();
});

describe("GET /admin/sales — access control", () => {
  it("401s an unauthenticated caller", async () => {
    mocks.currentUser = null;
    const res = await request(app).get("/api/admin/sales");
    expect(res.status).toBe(401);
  });

  it("403s a signed-in non-admin", async () => {
    const user = await createUser({ email: "not-admin@breakbpm.test" });
    mocks.currentUser = user;
    const res = await request(app).get("/api/admin/sales");
    expect(res.status).toBe(403);
  });
});

describe("GET /admin/sales — admin ledger", () => {
  it("returns valued rows with own-column tax and full-range totals", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;

    // A real $4.99 crypto sale (gst 22, pst 31, net 446) and a $0 comp.
    await seedSaleEvent(admin.id, {
      eventType: "crypto_purchase",
      paymentMethod: "crypto",
      productLabel: "Lucky Break",
    });
    await seedSaleEvent(admin.id, {
      eventType: "code_redemption",
      paymentMethod: "code",
      productLabel: "Day Pass",
      isComp: true,
      grossCents: 0,
      gstCents: 0,
      pstCents: 0,
      netCents: 0,
    });

    const res = await request(app).get("/api/admin/sales");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.rows).toHaveLength(2);

    // Totals back the tax out of the single real sale; the comp adds nothing.
    expect(res.body.totals.grossCents).toBe(499);
    expect(res.body.totals.gstCents).toBe(22);
    expect(res.body.totals.pstCents).toBe(31);
    expect(res.body.totals.netCents).toBe(446);
    expect(res.body.totals.compCount).toBe(1);
    expect(res.body.totals.rowCount).toBe(2);

    // gst + pst + net always reconciles to gross on every row.
    for (const row of res.body.rows) {
      expect(row.gstCents + row.pstCents + row.netCents).toBe(row.grossCents);
    }
  });

  it("filters by the [from, to) occurredAt range", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;

    const inRange = new Date("2026-03-15T12:00:00.000Z");
    const before = new Date("2026-01-01T12:00:00.000Z");
    await seedSaleEvent(admin.id, { occurredAt: inRange });
    await seedSaleEvent(admin.id, { occurredAt: before });

    const res = await request(app)
      .get("/api/admin/sales")
      .query({ from: "2026-03-01T00:00:00.000Z", to: "2026-04-01T00:00:00.000Z" });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.totals.rowCount).toBe(1);
  });

  it("exports the whole range as CSV (pagination ignored)", async () => {
    const admin = await createUser({ email: ADMIN_EMAIL });
    mocks.currentUser = admin;

    await seedSaleEvent(admin.id, { productLabel: "Lucky Break" });
    await seedSaleEvent(admin.id, {
      productLabel: "Day Pass",
      isComp: true,
      grossCents: 0,
      gstCents: 0,
      pstCents: 0,
      netCents: 0,
      paymentMethod: "code",
      eventType: "code_redemption",
    });

    const res = await request(app)
      .get("/api/admin/sales")
      .query({ format: "csv", limit: 1 });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);

    const lines = res.text.split("\r\n");
    // Header + both rows despite limit=1 (CSV ignores pagination).
    expect(lines[0]).toBe(
      "date,user,product,method,comp,gross_cad,gst_cad,pst_cad,net_cad,source_amount,source_currency,fx_rate,fx_date,reference",
    );
    expect(lines).toHaveLength(3);
    expect(res.text).toContain("4.99");
    expect(res.text).toContain("0.22");
    expect(res.text).toContain("0.31");
    expect(res.text).toContain("4.46");
  });
});
