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

// The redeem path mirrors a Lifetime grant to Stripe (best-effort). Stub the
// provider seam so the tests never touch the real connector.
vi.mock("../lib/paymentProvider", () => ({
  paymentProvider: {},
  stopRenewingStripeSubscriptions: vi.fn(async () => {}),
}));

import passesRouter from "./passes";
import {
  createUser,
  seedPass,
  seedDiscountCode,
  seedAdminDiscountCode,
  getPasses,
  getDiscountCode,
  getRedemptions,
  expirePass,
  uniqueCode,
  cleanup,
} from "../test/factories";
import { db, discountCodesTable, discountRedemptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GIFT_COOLDOWN_MS, GIFT_EXPIRY_MS } from "../lib/giftCodes";

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

afterEach(async () => {
  mocks.currentUser = null;
  vi.clearAllMocks();
  await cleanup();
});

describe("POST /passes/redeem — discount-code abuse & edge cases", () => {
  it("rejects an unknown code without granting a pass", async () => {
    const user = await createUser();
    mocks.currentUser = user;

    const res = await request(app)
      .post("/api/passes/redeem")
      .send({ code: uniqueCode("NOPE") });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/invalid code/i);
    expect(await getPasses(user.id)).toHaveLength(0);
  });

  it("rejects an expired code without granting a pass or burning a slot", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    const code = uniqueCode("EXP");
    await seedDiscountCode(code, "day", {
      maxRedemptions: 1,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const res = await request(app).post("/api/passes/redeem").send({ code });

    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/expired/i);
    expect(await getPasses(user.id)).toHaveLength(0);
    // The cap claim runs after the expiry check, so the count is untouched.
    expect((await getDiscountCode(code))!.redemptionCount).toBe(0);
  });

  it("rejects a fully-redeemed (cap reached) code for the next user", async () => {
    const code = uniqueCode("CAP");
    await seedDiscountCode(code, "day", { maxRedemptions: 1 });

    // First user consumes the only slot.
    const first = await createUser();
    mocks.currentUser = first;
    const res1 = await request(app).post("/api/passes/redeem").send({ code });
    expect(res1.body.success).toBe(true);
    expect((await getDiscountCode(code))!.redemptionCount).toBe(1);

    // Second user is refused — the cap is already at maxRedemptions.
    const second = await createUser();
    mocks.currentUser = second;
    const res2 = await request(app).post("/api/passes/redeem").send({ code });

    expect(res2.body.success).toBe(false);
    expect(res2.body.message).toMatch(/fully redeemed/i);
    expect(await getPasses(second.id)).toHaveLength(0);
    // The rolled-back claim must not push the count past the cap.
    expect((await getDiscountCode(code))!.redemptionCount).toBe(1);
  });

  it("refuses redemption while a pass is already active without burning a slot", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    await seedPass(user.id, "day");
    const code = uniqueCode("ACTIVE");
    await seedDiscountCode(code, "day", { maxRedemptions: 1 });

    const res = await request(app).post("/api/passes/redeem").send({ code });

    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/already have an active pass/i);
    // Pre-check happens before the tx, so the code's slot is preserved and no
    // second pass is granted.
    expect((await getDiscountCode(code))!.redemptionCount).toBe(0);
    expect(await getPasses(user.id)).toHaveLength(1);
    expect(await getRedemptions(user.id)).toHaveLength(0);
  });

  it("refuses a second redemption of the same code by the same user (unique guard)", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    const code = uniqueCode("DUP");
    // Unlimited cap so the duplicate is stopped by the (code,user) unique
    // index, not the cap.
    await seedDiscountCode(code, "day");

    // First redeem grants a Day pass.
    const res1 = await request(app).post("/api/passes/redeem").send({ code });
    expect(res1.body.success).toBe(true);
    const passesAfterFirst = await getPasses(user.id);
    expect(passesAfterFirst).toHaveLength(1);
    expect((await getDiscountCode(code))!.redemptionCount).toBe(1);

    // Expire that pass so the "already have an active pass" pre-check no longer
    // short-circuits — this forces the request all the way to the unique
    // (code,user) insert that is the canonical double-redeem guard.
    await expirePass(passesAfterFirst[0].id);

    const res2 = await request(app).post("/api/passes/redeem").send({ code });

    expect(res2.body.success).toBe(false);
    expect(res2.body.message).toMatch(/already redeemed/i);
    // The failed insert rolls the whole tx back: no second pass, no extra
    // redemption row, and the cap count is restored (still 1, not 2).
    expect(await getPasses(user.id)).toHaveLength(1);
    expect(await getRedemptions(user.id)).toHaveLength(1);
    expect((await getDiscountCode(code))!.redemptionCount).toBe(1);
  });

  it("normalizes the submitted code (trim + uppercase) before matching", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    const code = uniqueCode("NORM");
    await seedDiscountCode(code, "day", { maxRedemptions: 1 });

    const res = await request(app)
      .post("/api/passes/redeem")
      .send({ code: `  ${code.toLowerCase()}  ` });

    expect(res.body.success).toBe(true);
    expect((await getDiscountCode(code))!.redemptionCount).toBe(1);
  });
});

describe("POST /passes/discount-codes — Day-Pass gift-code abuse & edge cases", () => {
  it("rejects a user with no pass", async () => {
    const user = await createUser();
    mocks.currentUser = user;

    const res = await request(app).post("/api/passes/discount-codes").send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/year and lifetime/i);
    expect(res.body.code).toBeUndefined();
  });

  it("rejects a Day-pass holder (only Year/Lifetime are eligible)", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    await seedPass(user.id, "day");

    const res = await request(app).post("/api/passes/discount-codes").send({});

    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/year and lifetime/i);
  });

  it("mints a single-use, 24h Day-Pass code for a Year holder", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    await seedPass(user.id, "year");

    const before = Date.now();
    const res = await request(app).post("/api/passes/discount-codes").send({});
    const after = Date.now();

    expect(res.body.success).toBe(true);
    expect(res.body.code).toBeDefined();
    expect(res.body.code.grantsPassKind).toBe("day");
    expect(res.body.code.redeemed).toBe(false);
    expect(res.body.code.expired).toBe(false);

    // The minted row is single-use (cap of 1) and lives for 24h.
    const row = (await getDiscountCode(res.body.code.code))!;
    expect(row.maxRedemptions).toBe(1);
    expect(row.grantsPassKind).toBe("day");
    expect(row.issuedByUserId).toBe(user.id);

    const issuedAt = new Date(res.body.code.issuedAt).getTime();
    const expiresAt = new Date(res.body.code.expiresAt).getTime();
    expect(expiresAt - issuedAt).toBe(GIFT_EXPIRY_MS);
    expect(issuedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(issuedAt).toBeLessThanOrEqual(after + 1000);

    // nextAvailableAt is one cooldown out from issuance.
    const nextAvailableAt = new Date(res.body.nextAvailableAt).getTime();
    expect(nextAvailableAt - issuedAt).toBe(GIFT_COOLDOWN_MS);
  });

  it("allows a Lifetime holder to mint a Day-Pass code", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    await seedPass(user.id, "lifetime");

    const res = await request(app).post("/api/passes/discount-codes").send({});

    expect(res.body.success).toBe(true);
    expect(res.body.code.grantsPassKind).toBe("day");
  });

  it("blocks a second mint within the cooldown and reports nextAvailableAt", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    await seedPass(user.id, "year");

    const first = await request(app)
      .post("/api/passes/discount-codes")
      .send({});
    expect(first.body.success).toBe(true);
    const firstIssuedAt = new Date(first.body.code.issuedAt).getTime();

    const second = await request(app)
      .post("/api/passes/discount-codes")
      .send({});

    expect(second.body.success).toBe(false);
    expect(second.body.message).toMatch(/cooldown/i);
    // The cooldown is generation-based: nextAvailableAt is anchored to the
    // FIRST mint (within a small clock-drift tolerance — the route recomputes
    // it from Date.now() + remaining), not extended by the blocked attempt.
    const next = new Date(second.body.nextAvailableAt).getTime();
    expect(next).toBeGreaterThan(Date.now());
    expect(Math.abs(next - firstIssuedAt - GIFT_COOLDOWN_MS)).toBeLessThan(5000);

    // Only the first code exists; the blocked attempt minted nothing extra.
    const minted = await db
      .select()
      .from(discountRedemptionsTable)
      .where(eq(discountRedemptionsTable.userId, user.id));
    expect(minted).toHaveLength(0);
  });

  it("supersedes a prior unused code when the cooldown has elapsed", async () => {
    const user = await createUser();
    mocks.currentUser = user;
    await seedPass(user.id, "year");

    const first = await request(app)
      .post("/api/passes/discount-codes")
      .send({});
    expect(first.body.success).toBe(true);
    const firstCode = first.body.code.code as string;

    // Back-date the first mint past the cooldown so a new mint is allowed.
    await db
      .update(discountCodesTable)
      .set({
        issuedAt: new Date(Date.now() - GIFT_COOLDOWN_MS - 60_000),
      })
      .where(eq(discountCodesTable.code, firstCode));

    const second = await request(app)
      .post("/api/passes/discount-codes")
      .send({});
    expect(second.body.success).toBe(true);
    expect(second.body.code.code).not.toBe(firstCode);

    // The earlier unused code is superseded (its expiry stamped to now-ish).
    const superseded = (await getDiscountCode(firstCode))!;
    expect(superseded.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe("POST /passes/redeem — admin-issued code redemption", () => {
  it("grants a Day pass when redeeming an admin day code", async () => {
    const admin = await createUser();
    const user = await createUser();
    mocks.currentUser = user;
    const code = uniqueCode("ADMDAY");
    await seedAdminDiscountCode(code, "day", admin.id, { maxRedemptions: 1 });

    const res = await request(app).post("/api/passes/redeem").send({ code });

    expect(res.body.success).toBe(true);
    const passes = await getPasses(user.id);
    expect(passes).toHaveLength(1);
    expect(passes[0]!.kind).toBe("day");
    expect((await getDiscountCode(code))!.redemptionCount).toBe(1);
  });

  it("grants a Month pass when redeeming an admin month code", async () => {
    const admin = await createUser();
    const user = await createUser();
    mocks.currentUser = user;
    const code = uniqueCode("ADMMON");
    await seedAdminDiscountCode(code, "month", admin.id, { maxRedemptions: 1 });

    const res = await request(app).post("/api/passes/redeem").send({ code });

    expect(res.body.success).toBe(true);
    const passes = await getPasses(user.id);
    expect(passes).toHaveLength(1);
    expect(passes[0]!.kind).toBe("month");
  });

  it("grants a Year pass when redeeming an admin year code", async () => {
    const admin = await createUser();
    const user = await createUser();
    mocks.currentUser = user;
    const code = uniqueCode("ADMYR");
    await seedAdminDiscountCode(code, "year", admin.id, { maxRedemptions: 1 });

    const res = await request(app).post("/api/passes/redeem").send({ code });

    expect(res.body.success).toBe(true);
    const passes = await getPasses(user.id);
    expect(passes).toHaveLength(1);
    expect(passes[0]!.kind).toBe("year");
  });

  it("grants a Lifetime pass when redeeming an admin lifetime code", async () => {
    const admin = await createUser();
    const user = await createUser();
    mocks.currentUser = user;
    const code = uniqueCode("ADMLIFE");
    await seedAdminDiscountCode(code, "lifetime", admin.id, { maxRedemptions: 1 });

    const res = await request(app).post("/api/passes/redeem").send({ code });

    expect(res.body.success).toBe(true);
    const passes = await getPasses(user.id);
    expect(passes).toHaveLength(1);
    expect(passes[0]!.kind).toBe("lifetime");
    // durationSeconds is null for a Lifetime pass.
    expect(passes[0]!.durationSeconds).toBeNull();
  });

  it("allows distinct users to redeem a multi-use admin code up to its cap, then refuses", async () => {
    const admin = await createUser();
    const code = uniqueCode("ADMCAP");
    await seedAdminDiscountCode(code, "month", admin.id, { maxRedemptions: 2 });

    const u1 = await createUser();
    mocks.currentUser = u1;
    const r1 = await request(app).post("/api/passes/redeem").send({ code });
    expect(r1.body.success).toBe(true);
    expect((await getDiscountCode(code))!.redemptionCount).toBe(1);

    const u2 = await createUser();
    mocks.currentUser = u2;
    const r2 = await request(app).post("/api/passes/redeem").send({ code });
    expect(r2.body.success).toBe(true);
    expect((await getDiscountCode(code))!.redemptionCount).toBe(2);

    // Third user is refused — cap is already at maxRedemptions.
    const u3 = await createUser();
    mocks.currentUser = u3;
    const r3 = await request(app).post("/api/passes/redeem").send({ code });
    expect(r3.body.success).toBe(false);
    expect(r3.body.message).toMatch(/fully redeemed/i);
    expect(await getPasses(u3.id)).toHaveLength(0);
    // The rolled-back claim must not increment the count past the cap.
    expect((await getDiscountCode(code))!.redemptionCount).toBe(2);
  });

  it("admin code's issuedAt does not count toward the gift-code cooldown (giftScope isolation)", async () => {
    // A user holds a Year pass (gift-eligible). An admin code was minted under
    // their userId very recently (as if they are also an admin). That admin
    // code's issuedAt must be invisible to giftScope(), so the gift cooldown
    // check must NOT block them from minting their first gift code.
    const user = await createUser();
    mocks.currentUser = user;
    await seedPass(user.id, "year");

    // Admin code seeded under the same issuedByUserId, fresh issuedAt (within
    // what would be a cooldown window if the gift flow could see it).
    const adminCode = uniqueCode("ADMISO");
    await seedAdminDiscountCode(adminCode, "month", user.id, {
      maxRedemptions: null,
      issuedAt: new Date(Date.now() - 60_000), // 1 minute ago
    });

    // Minting a gift code must succeed — the admin code's issuedAt is scoped out.
    const res = await request(app).post("/api/passes/discount-codes").send({});
    expect(res.body.success).toBe(true);
    expect(res.body.code.grantsPassKind).toBe("day");

    // The admin code itself is untouched by the gift flow.
    const adminRow = (await getDiscountCode(adminCode))!;
    expect(adminRow.redemptionCount).toBe(0);
    expect(adminRow.expiresAt).toBeNull();
  });

  it("gift-code supersede does not expire admin codes sharing issuedByUserId", async () => {
    // A user (Lifetime holder) generates two successive gift codes. Between
    // the first and second mints, they also have an admin code filed under
    // the same issuedByUserId. The supersede step inside the gift flow must
    // only retire the old gift code, never the admin code.
    const user = await createUser();
    mocks.currentUser = user;
    await seedPass(user.id, "lifetime");

    // First gift-code mint.
    const first = await request(app).post("/api/passes/discount-codes").send({});
    expect(first.body.success).toBe(true);
    const firstGiftCode = first.body.code.code as string;

    // Seed an admin code under the same user (shared issuedByUserId).
    const adminCode = uniqueCode("ADMSUPER");
    await seedAdminDiscountCode(adminCode, "year", user.id, { maxRedemptions: null });

    // Back-date the first gift code so the cooldown has elapsed.
    await db
      .update(discountCodesTable)
      .set({ issuedAt: new Date(Date.now() - GIFT_COOLDOWN_MS - 60_000) })
      .where(eq(discountCodesTable.code, firstGiftCode));

    // Second gift-code mint — triggers the supersede step for the old gift code.
    const second = await request(app).post("/api/passes/discount-codes").send({});
    expect(second.body.success).toBe(true);
    expect(second.body.code.code).not.toBe(firstGiftCode);

    // The old gift code is superseded (expiresAt stamped to now-ish).
    const supersededGift = (await getDiscountCode(firstGiftCode))!;
    expect(supersededGift.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    // The admin code must NOT be touched — expiresAt stays null, count stays 0.
    const adminRow = (await getDiscountCode(adminCode))!;
    expect(adminRow.expiresAt).toBeNull();
    expect(adminRow.redemptionCount).toBe(0);
  });
});
