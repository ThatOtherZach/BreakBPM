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

// Stub the payment provider seam. Both Lifetime grant paths (verify + redeem)
// mirror the local subscription stop to Stripe via stopRenewingStripeSubscriptions
// after the tx, so the mock must export it or those handlers throw a 500.
vi.mock("../lib/paymentProvider", () => ({
  paymentProvider: mocks.provider,
  stopRenewingStripeSubscriptions: vi.fn(async () => {}),
}));

// Pin the USD→CAD rate so the sale ledger is deterministic and never hits the
// Bank-of-Canada network. 1.35 is non-unity to prove the conversion is applied.
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
const FX_MICROS = 1_350_000;
const toCad = (usdCents: number) =>
  Math.round((usdCents * FX_MICROS) / 1_000_000);

// These suites exercise the card-payment-gated flows (passes/verify,
// subscriptions/checkout) plus the Lifetime-stops-subscription rule, all of
// which assume in-app card payments are ON. cardPaymentsEnabled() reads the
// env at call time, so force the flag here to keep the suite deterministic
// regardless of the ambient default (which is OFF in code).
process.env.BREAKBPM_CARD_PAYMENTS_ENABLED = "true";

import passesRouter from "./passes";
import subscriptionsRouter from "./subscriptions";
import {
  createUser,
  seedPass,
  seedSubscription,
  seedDiscountCode,
  getSubscriptions,
  getPasses,
  getSaleEvents,
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

describe("passes/verify records a Stripe sale in the ledger", () => {
  it("records one taxed stripe_purchase row keyed on the payment intent", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    mocks.provider.verifyAndGrant.mockResolvedValue({
      success: true,
      message: "Granted",
      kind: "day",
      providerRef: "pi_sale_test",
    });

    const res = await request(app)
      .post("/api/passes/verify")
      .send({ opaqueToken: "tok_sale" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const sales = await getSaleEvents(user.id);
    expect(sales).toHaveLength(1);
    const sale = sales[0]!;
    expect(sale.eventType).toBe("stripe_purchase");
    expect(sale.paymentMethod).toBe("stripe");
    expect(sale.isComp).toBe(false);
    expect(sale.providerRef).toBe("pi_sale_test");
    // gross is the CAD value of the USD source price at the pinned BoC rate.
    expect(sale.sourceCurrency).toBe("USD");
    expect(sale.fxRateMicros).toBe(FX_MICROS);
    expect(sale.grossCents).toBe(toCad(sale.sourceGrossCents));
    // Tax is backed out of the gross and reconciles exactly.
    expect(sale.gstCents + sale.pstCents + sale.netCents).toBe(sale.grossCents);
  });

  it("is idempotent — a replayed verify (same payment intent) writes no second row", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    mocks.provider.verifyAndGrant.mockResolvedValue({
      success: true,
      message: "Granted",
      kind: "day",
      providerRef: "pi_dupe_test",
    });

    const first = await request(app)
      .post("/api/passes/verify")
      .send({ opaqueToken: "tok_dupe" });
    expect(first.body.success).toBe(true);

    const second = await request(app)
      .post("/api/passes/verify")
      .send({ opaqueToken: "tok_dupe" });
    expect(second.body.success).toBe(true);

    // The grant deduped on the second call, so exactly one sale row exists.
    expect(await getSaleEvents(user.id)).toHaveLength(1);
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
