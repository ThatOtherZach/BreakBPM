import { describe, it, expect, afterEach, vi } from "vitest";
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
  getOrCreateUser: vi.fn(async () => mocks.currentUser),
}));

// A Lifetime grant mirrors a best-effort cancel to Stripe. Stub the provider
// seam so tests never touch the real connector.
vi.mock("../lib/paymentProvider", () => ({
  paymentProvider: {},
  stopRenewingStripeSubscriptions: vi.fn(async () => {}),
}));

// Stub the shot-entropy gatherer so Lucky Break rolls are deterministic and
// never depend on live game data. Empty array → zero-shot entropy; the roll
// engine seeds the draw from the crypto order id alone.
vi.mock("../lib/luckyBreakEntropy", () => ({
  gatherShotEntropy: vi.fn(async () => []),
}));

// Pin the USD→CAD rate so the sale ledger is deterministic and never hits the
// Bank-of-Canada network. 1.35 is intentionally non-unity to prove the CAD
// conversion is actually applied (CAD gross = round(USD * 1.35)).
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

// Stub all on-chain access. The verify route resolves config + reads the tx via
// these; we make config "ready", pin the chain id, and report a confirmed
// payment so the route runs its in-tx draw + grant against the real database.
vi.mock("../lib/cryptoChain", () => ({
  cryptoConfigured: vi.fn(() => true),
  getNetworkConfig: vi.fn(() => ({
    network: "base",
    chainId: 8453,
    usdcAddress: `0x${"b".repeat(40)}`,
    usdcDecimals: 6,
  })),
  getReceivingAddress: vi.fn(() => `0x${"a".repeat(40)}`),
  getQuoteTtlSeconds: vi.fn(() => 900),
  readEthUsd: vi.fn(),
  usdcAtomicAmount: vi.fn(),
  ethWeiAmount: vi.fn(),
  // A confirmed payment, landed well after the order was created (so the manual
  // lower-bound replay guard is satisfied).
  verifyPayment: vi.fn(async () => ({
    status: "granted" as const,
    blockTimestamp: Math.floor(Date.now() / 1000) + 300,
  })),
  verifyPayerSignature: vi.fn(),
  findIncomingUsdcTx: vi.fn(),
}));

import cryptoRouter from "./crypto";
import {
  createUser,
  seedCryptoOrder,
  getPasses,
  getLuckyBreakRolls,
  getCryptoOrder,
  getSaleEvents,
  cleanup,
} from "../test/factories";
import {
  computeLuckyBreakRoll,
  LUCKY_BREAK_CODE_KIND,
  LUCKY_BREAK_WINDOW_DAYS,
} from "../lib/luckyBreak";

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
  app.use("/api", cryptoRouter);
  return app;
}

const app = makeApp();

/** A valid lowercased 0x + 64-hex transaction hash. */
function txHash(seed = "c"): string {
  return `0x${seed.repeat(64).slice(0, 64)}`;
}

afterEach(async () => {
  mocks.currentUser = null;
  vi.clearAllMocks();
  await cleanup();
});

describe("POST /crypto/verify — Lucky Break order", () => {
  it("runs the seeded draw, grants the won pass, and writes a matching audit row", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    const order = await seedCryptoOrder(user.id, {
      passKind: LUCKY_BREAK_CODE_KIND,
    });

    // The draw is pure + seeded by the stable order id, so we can pre-compute
    // the outcome (empty entropy mirrors the stubbed gatherer).
    const expected = computeLuckyBreakRoll([], order.id);

    const res = await request(app)
      .post("/api/crypto/verify")
      .send({ orderId: order.id, txHash: txHash() });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("granted");

    // The reveal envelope must be present and land on a guaranteed-win tier.
    expect(res.body.luckyBreak).toBeDefined();
    const outcome = res.body.luckyBreak.outcome as string;
    expect(["month", "lifetime"]).toContain(outcome);
    expect(outcome).toBe(expected.outcome);

    // The granted pass must match the roll outcome.
    expect(res.body.pass.kind).toBe(outcome);
    const passes = await getPasses(user.id);
    expect(passes).toHaveLength(1);
    expect(passes[0]!.kind).toBe(outcome);
    // The recorded price is what was actually paid (the Lucky Break price), not
    // the catalog price of the won tier.
    expect(passes[0]!.priceCents).toBe(order.priceCents);

    // Exactly one audit row, written in the same tx as the grant.
    const rolls = await getLuckyBreakRolls(user.id);
    expect(rolls).toHaveLength(1);
    const roll = rolls[0]!;

    // Crypto-sourced roll: cryptoOrderId set, code/redemptionId null.
    expect(roll.cryptoOrderId).toBe(order.id);
    expect(roll.code).toBeNull();
    expect(roll.redemptionId).toBeNull();

    // seedHash is tied to the crypto order id (seed reproduction).
    expect(roll.seedHash).toBe(expected.seedHash);
    expect(roll.seedHash).toBe(res.body.luckyBreak.seedHash);

    // Outcome + odds + window + entropy snapshot.
    expect(roll.outcome).toBe(outcome);
    expect(roll.lifetimeProbabilityBps).toBe(2000);
    expect(roll.windowDays).toBe(LUCKY_BREAK_WINDOW_DAYS);
    expect(roll.entropyShotCount).toBe(0);

    // passId wires the audit row to the granted pass.
    expect(roll.passId).toBe(passes[0]!.id);

    // The order is settled and bound to the granted pass + tx hash.
    const settled = (await getCryptoOrder(order.id))!;
    expect(settled.status).toBe("paid");
    expect(settled.passId).toBe(passes[0]!.id);
    expect(settled.txHash).toBe(txHash());

    // One real, taxed crypto sale recorded, valued at what was paid and keyed
    // by the tx hash. gst + pst + net reconciles back to the gross.
    const sales = await getSaleEvents(user.id);
    expect(sales).toHaveLength(1);
    const sale = sales[0]!;
    expect(sale.eventType).toBe("crypto_purchase");
    expect(sale.paymentMethod).toBe("crypto");
    expect(sale.isComp).toBe(false);
    // gross is the CAD value (USD price converted at the pinned BoC rate); the
    // original USD amount is preserved for audit.
    expect(sale.sourceGrossCents).toBe(order.priceCents);
    expect(sale.sourceCurrency).toBe("USD");
    expect(sale.fxRateMicros).toBe(FX_MICROS);
    expect(sale.grossCents).toBe(toCad(order.priceCents));
    expect(sale.providerRef).toBe(txHash());
    expect(sale.gstCents + sale.pstCents + sale.netCents).toBe(sale.grossCents);
  });

  it("is idempotent on replay — no second roll, no second pass", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    const order = await seedCryptoOrder(user.id, {
      passKind: LUCKY_BREAK_CODE_KIND,
    });

    const first = await request(app)
      .post("/api/crypto/verify")
      .send({ orderId: order.id, txHash: txHash() });
    expect(first.body.success).toBe(true);
    expect(first.body.status).toBe("granted");
    const firstOutcome = first.body.luckyBreak.outcome as string;

    // Re-verify the now-settled order (same tx hash). The route must replay the
    // persisted roll WITHOUT drawing again or granting a second pass.
    const second = await request(app)
      .post("/api/crypto/verify")
      .send({ orderId: order.id, txHash: txHash() });

    expect(second.body.success).toBe(true);
    expect(second.body.status).toBe("granted");
    // The replayed reveal matches the original draw exactly.
    expect(second.body.luckyBreak.outcome).toBe(firstOutcome);
    expect(second.body.luckyBreak.seedHash).toBe(first.body.luckyBreak.seedHash);
    expect(second.body.pass.kind).toBe(firstOutcome);

    // Still exactly one pass and one audit row after the replay.
    expect(await getPasses(user.id)).toHaveLength(1);
    expect(await getLuckyBreakRolls(user.id)).toHaveLength(1);
    // The sale ledger is keyed by tx hash (ON CONFLICT DO NOTHING), so the
    // replay must not write a second row.
    expect(await getSaleEvents(user.id)).toHaveLength(1);
  });
});
