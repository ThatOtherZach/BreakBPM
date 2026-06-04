import { describe, it, expect, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Mutable test state shared with the module mocks. Declared via vi.hoisted so
// it is initialised before the (hoisted) vi.mock factories run.
const mocks = vi.hoisted(() => ({
  currentUser: null as { id: string } | null,
  provider: {
    createCheckout: vi.fn(),
    verifyAndGrant: vi.fn(),
    createSubscriptionCheckout: vi.fn(),
    verifyAndActivateSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
  },
}));

// Stub auth: the route handlers only call getOrCreateUser. We return whichever
// user the current test seeded, bypassing Clerk entirely.
vi.mock("../lib/auth", () => ({
  getOrCreateUser: vi.fn(async () => mocks.currentUser),
}));

// Stub the payment provider seam.
vi.mock("../lib/paymentProvider", () => ({
  paymentProvider: mocks.provider,
}));

import passesRouter from "./passes";
import subscriptionsRouter from "./subscriptions";
import {
  createUser,
  seedPass,
  seedSubscription,
  seedDiscountCode,
  getSubscriptions,
  getPasses,
  uniqueCode,
  cleanup,
} from "../test/factories";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  // Route handlers log via req.log (added by pino-http in prod). Stub it.
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      info() {},
      warn() {},
      error() {},
    };
    next();
  });
  app.use("/api", passesRouter);
  app.use("/api", subscriptionsRouter);
  return app;
}

const app = makeApp();

afterEach(async () => {
  mocks.currentUser = null;
  vi.clearAllMocks();
  await cleanup();
});

describe("Lifetime stops an active subscription from renewing", () => {
  it("via a Lifetime purchase (passes/verify)", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    await seedSubscription(user.id, { cancelAtPeriodEnd: false });
    mocks.provider.verifyAndGrant.mockResolvedValue({
      success: true,
      message: "Granted",
      kind: "lifetime",
      providerRef: "pi_test",
    });

    const res = await request(app)
      .post("/api/passes/verify")
      .send({ opaqueToken: "tok_test" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const subs = await getSubscriptions(user.id);
    expect(subs).toHaveLength(1);
    expect(subs[0].cancelAtPeriodEnd).toBe(true);
    expect(subs[0].canceledAt).not.toBeNull();
  });

  it("via redeeming a Lifetime discount code (passes/redeem)", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    await seedSubscription(user.id, { cancelAtPeriodEnd: false });
    const code = uniqueCode("LIFE");
    await seedDiscountCode(code, "lifetime");

    const res = await request(app).post("/api/passes/redeem").send({ code });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const subs = await getSubscriptions(user.id);
    expect(subs[0].cancelAtPeriodEnd).toBe(true);
    const passes = await getPasses(user.id);
    expect(passes.some((p) => p.kind === "lifetime")).toBe(true);
  });

  it("does not flag subscriptions when a non-Lifetime (Day) code is redeemed", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    const sub = await seedSubscription(user.id, { cancelAtPeriodEnd: false });
    // The rule is specifically Lifetime-only — granting a non-lifetime pass
    // must NOT stop the subscription from renewing. A subscription is not a
    // pass, so the "already have an active pass" guard does not block this.
    const code = uniqueCode("DAY");
    await seedDiscountCode(code, "day");

    const res = await request(app).post("/api/passes/redeem").send({ code });
    expect(res.body.success).toBe(true);

    const subs = await getSubscriptions(user.id);
    const refreshed = subs.find((s) => s.id === sub.id)!;
    expect(refreshed.cancelAtPeriodEnd).toBe(false);
  });
});

describe("subscribe is refused when a Lifetime pass is held", () => {
  it("subscriptions/checkout refuses and does not hit the provider", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    await seedPass(user.id, "lifetime");

    const res = await request(app)
      .post("/api/subscriptions/checkout")
      .send({ interval: "month" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Lifetime/i);
    expect(mocks.provider.createSubscriptionCheckout).not.toHaveBeenCalled();
  });
});
