import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Mutable test state shared with the module mocks. Declared via vi.hoisted so
// it is initialised before the (hoisted) vi.mock factories run.
const mocks = vi.hoisted(() => ({
  currentUser: null as { id: string } | null,
}));

// Stub auth. Default to the single seeded `currentUser`, but also honor a
// per-request `x-test-user` header so the concurrency test can drive two
// distinct callers through Promise.all (one shared currentUser cannot).
vi.mock("../lib/auth", () => ({
  getOrCreateUser: vi.fn(async (req: { headers?: Record<string, unknown> }) => {
    const hdr = req?.headers?.["x-test-user"];
    if (typeof hdr === "string" && hdr) return { id: hdr };
    return mocks.currentUser;
  }),
}));

// The Lifetime grant path mirrors to Stripe (best-effort). Stub the seam so the
// tests never touch the real connector.
vi.mock("../lib/paymentProvider", () => ({
  paymentProvider: {},
  stopRenewingStripeSubscriptions: vi.fn(async () => {}),
}));

// Deterministic, network-free Lucky Break draw: empty entropy (the redemption
// id alone seeds the pure roll engine).
vi.mock("../lib/luckyBreakEntropy", () => ({
  gatherShotEntropy: vi.fn(async () => []),
}));

// Pin the USD→CAD rate so the ledger never hits the Bank-of-Canada network.
vi.mock("../lib/fx", () => ({
  getUsdToCadRate: vi.fn(async () => ({
    rateMicros: 1_350_000,
    rateDate: "2026-06-01",
    source: "bank_of_canada" as const,
  })),
  getUsdToCadRateForDate: vi.fn(async () => ({
    rateMicros: 1_350_000,
    rateDate: "2026-06-01",
    source: "bank_of_canada" as const,
  })),
  convertUsdToCad: (usdCents: number, rateMicros: number) =>
    Math.round((usdCents * rateMicros) / 1_000_000),
}));

import passesRouter from "./passes";
import {
  createUser,
  seedPass,
  expirePass,
  getPasses,
  getDiscountCode,
  getSaleEvents,
  getLuckyBreakRolls,
  seedFreePassPool,
  getFreePassClaim,
  getFreePassPools,
  deleteFreePassPools,
  cleanup,
} from "../test/factories";
import { freePassMonthlyCap } from "../lib/config";
import { currentPeriodKey } from "../lib/freePassClaims";

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
  return app;
}

const app = makeApp();
const CAP = freePassMonthlyCap();
const PERIOD = currentPeriodKey();

beforeEach(async () => {
  // Start every case from an empty current-period inventory.
  await deleteFreePassPools(PERIOD);
});

afterEach(async () => {
  mocks.currentUser = null;
  vi.clearAllMocks();
  await cleanup();
  await deleteFreePassPools(PERIOD);
});

describe("POST /passes/claim", () => {
  it("grants a Day pass, wires a self-describing claim row, and books a $0 comp", async () => {
    // Exhaust the Lucky Break pool so the draw deterministically lands on Day.
    await seedFreePassPool(PERIOD, "lucky_break", CAP);
    const user = await createUser();
    mocks.currentUser = user;

    const res = await request(app).post("/api/passes/claim").send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.rewardKind).toBe("day");
    expect(res.body.luckyBreak).toBeUndefined();

    // Exactly one Day pass granted.
    const passes = await getPasses(user.id);
    expect(passes).toHaveLength(1);
    expect(passes[0]!.kind).toBe("day");

    // The claim row is self-describing and wired to the minted code.
    const claim = await getFreePassClaim(user.id);
    expect(claim).toBeDefined();
    expect(claim!.rewardKind).toBe("day");
    expect(claim!.periodKey).toBe(PERIOD);
    expect(claim!.sequence).toBe(1);
    expect(claim!.code).toMatch(/^D-/);

    // The minted code is single-use and tagged issuerKind='claim'.
    const code = (await getDiscountCode(claim!.code))!;
    expect(code.issuerKind).toBe("claim");
    expect(code.maxRedemptions).toBe(1);
    expect(code.redemptionCount).toBe(1);
    expect(code.grantsPassKind).toBe("day");

    // A free claim is a $0 comp in the ledger — never paid revenue.
    const sales = await getSaleEvents(user.id);
    expect(sales).toHaveLength(1);
    expect(sales[0]!.eventType).toBe("code_redemption");
    expect(sales[0]!.isComp).toBe(true);
    expect(sales[0]!.grossCents).toBe(0);
    expect(sales[0]!.netCents).toBe(0);

    // The Day pool advanced by exactly one.
    const day = (await getFreePassPools(PERIOD)).find((p) => p.rewardKind === "day");
    expect(day!.claimedCount).toBe(1);
  });

  it("books a free Lucky Break draw as a $0 comp, NOT the $4.99 price", async () => {
    // Exhaust the Day pool so the draw must land on Lucky Break.
    await seedFreePassPool(PERIOD, "day", CAP);
    const user = await createUser();
    mocks.currentUser = user;

    const res = await request(app).post("/api/passes/claim").send({});

    expect(res.body.success).toBe(true);
    expect(res.body.rewardKind).toBe("lucky_break");
    // A Lucky Break draw returns the reveal envelope and grants month|lifetime.
    expect(res.body.luckyBreak).toBeDefined();
    const outcome = res.body.luckyBreak.outcome as string;
    expect(["month", "lifetime"]).toContain(outcome);

    const passes = await getPasses(user.id);
    expect(passes).toHaveLength(1);
    expect(passes[0]!.kind).toBe(outcome);

    // An audit roll row exists (same wiring as a paid Lucky Break).
    expect(await getLuckyBreakRolls(user.id)).toHaveLength(1);

    // THE CARVE-OUT: a free Lucky Break must be a $0 comp, not booked at the
    // $4.99 Lucky Break price.
    const sales = await getSaleEvents(user.id);
    expect(sales).toHaveLength(1);
    expect(sales[0]!.isComp).toBe(true);
    expect(sales[0]!.grossCents).toBe(0);
    expect(sales[0]!.sourceGrossCents).toBe(0);
    expect(sales[0]!.netCents).toBe(0);

    const lb = (await getFreePassPools(PERIOD)).find((p) => p.rewardKind === "lucky_break");
    expect(lb!.claimedCount).toBe(1);
  });

  it("refuses a second claim by the same account (one per account, ever)", async () => {
    await seedFreePassPool(PERIOD, "lucky_break", CAP); // force Day for determinism
    const user = await createUser();
    mocks.currentUser = user;

    const first = await request(app).post("/api/passes/claim").send({});
    expect(first.body.success).toBe(true);

    // The granted Day pass would normally trigger the has_pass pre-check, so
    // expire it to force the request to the already-claimed guard specifically.
    const [pass] = await getPasses(user.id);
    await expirePass(pass.id);

    const second = await request(app).post("/api/passes/claim").send({});
    expect(second.body.success).toBe(false);
    expect(second.body.reason).toBe("already_claimed");

    // Still exactly one pass, one claim row, one pool decrement.
    expect(await getPasses(user.id)).toHaveLength(1);
    const day = (await getFreePassPools(PERIOD)).find((p) => p.rewardKind === "day");
    expect(day!.claimedCount).toBe(1);
  });

  it("refuses when the caller already holds an active pass (no stock burned)", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    await seedPass(user.id, "month");

    const res = await request(app).post("/api/passes/claim").send({});

    expect(res.body.success).toBe(false);
    expect(res.body.reason).toBe("has_pass");
    // No claim row, no pool created — the pre-check short-circuits before the tx.
    expect(await getFreePassClaim(user.id)).toBeUndefined();
    expect(await getFreePassPools(PERIOD)).toHaveLength(0);
  });

  it("refuses with pool_empty when both pools are exhausted, granting nothing", async () => {
    await seedFreePassPool(PERIOD, "lucky_break", CAP);
    await seedFreePassPool(PERIOD, "day", CAP);
    const user = await createUser();
    mocks.currentUser = user;

    const res = await request(app).post("/api/passes/claim").send({});

    expect(res.body.success).toBe(false);
    expect(res.body.reason).toBe("pool_empty");
    expect(await getPasses(user.id)).toHaveLength(0);
    expect(await getFreePassClaim(user.id)).toBeUndefined();

    // Neither pool was oversold past the cap.
    for (const pool of await getFreePassPools(PERIOD)) {
      expect(pool.claimedCount).toBe(CAP);
    }
  });

  it("never oversells under concurrency: one last slot, two racing claimers", async () => {
    // Lucky Break full, Day one short of cap → exactly ONE slot remains.
    await seedFreePassPool(PERIOD, "lucky_break", CAP);
    await seedFreePassPool(PERIOD, "day", CAP - 1);
    const a = await createUser();
    const b = await createUser();

    const [r1, r2] = await Promise.all([
      request(app).post("/api/passes/claim").set("x-test-user", a.id).send({}),
      request(app).post("/api/passes/claim").set("x-test-user", b.id).send({}),
    ]);

    const bodies = [r1.body, r2.body];
    const wins = bodies.filter((x) => x.success);
    const losses = bodies.filter((x) => !x.success);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(losses[0]!.reason).toBe("pool_empty");

    // The atomic guarded UPDATE never lets the Day pool exceed the cap.
    const day = (await getFreePassPools(PERIOD)).find((p) => p.rewardKind === "day");
    expect(day!.claimedCount).toBe(CAP);

    // Exactly one pass granted across both racers.
    const total = (await getPasses(a.id)).length + (await getPasses(b.id)).length;
    expect(total).toBe(1);
  });
});

describe("GET /passes/claim/status", () => {
  it("reports stock and open=true for an anonymous caller", async () => {
    const res = await request(app).get("/api/passes/claim/status");

    expect(res.status).toBe(200);
    expect(res.body.open).toBe(true);
    expect(res.body.signedIn).toBe(false);
    expect(res.body.monthlyCap).toBe(CAP);
    expect(res.body.remainingLuckyBreak).toBe(CAP);
    expect(res.body.remainingDay).toBe(CAP);
    // Optional auth-only fields are omitted for an anonymous caller.
    expect(res.body.alreadyClaimed).toBeUndefined();
    expect(res.body.eligible).toBeUndefined();
  });

  it("reports eligible=true for a signed-in caller who has not claimed", async () => {
    const user = await createUser();
    mocks.currentUser = user;

    const res = await request(app).get("/api/passes/claim/status");

    expect(res.body.signedIn).toBe(true);
    expect(res.body.alreadyClaimed).toBe(false);
    expect(res.body.eligible).toBe(true);
  });

  it("reports alreadyClaimed=true and eligible=false after a claim", async () => {
    await seedFreePassPool(PERIOD, "lucky_break", CAP); // force Day
    const user = await createUser();
    mocks.currentUser = user;
    await request(app).post("/api/passes/claim").send({});

    const res = await request(app).get("/api/passes/claim/status");

    expect(res.body.alreadyClaimed).toBe(true);
    expect(res.body.eligible).toBe(false);
  });

  it("reports open=false when both pools are exhausted", async () => {
    await seedFreePassPool(PERIOD, "lucky_break", CAP);
    await seedFreePassPool(PERIOD, "day", CAP);

    const res = await request(app).get("/api/passes/claim/status");

    expect(res.body.open).toBe(false);
    expect(res.body.remainingLuckyBreak).toBe(0);
    expect(res.body.remainingDay).toBe(0);
  });
});
