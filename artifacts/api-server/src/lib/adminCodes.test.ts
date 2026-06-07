import { describe, it, expect, afterEach } from "vitest";
import { createAdminDiscountCode, listAdminDiscountCodes } from "./adminCodes";
import { createUser, getDiscountCode, cleanup } from "../test/factories";

afterEach(cleanup);

describe("createAdminDiscountCode", () => {
  it("mints a code tagged issuerKind=admin with the chosen tier + cap", async () => {
    const admin = await createUser();
    const result = await createAdminDiscountCode({
      issuedByUserId: admin.id,
      kind: "month",
      maxRedemptions: 5,
    });

    expect(result.grantsPassKind).toBe("month");
    expect(result.maxRedemptions).toBe(5);
    expect(result.redemptionCount).toBe(0);

    const row = await getDiscountCode(result.code);
    expect(row).toBeDefined();
    expect(row?.issuerKind).toBe("admin");
    expect(row?.issuedByUserId).toBe(admin.id);
    expect(row?.grantsPassKind).toBe("month");
    expect(row?.maxRedemptions).toBe(5);
    // Admin codes never expire.
    expect(row?.expiresAt).toBeNull();
  });

  it("supports unlimited redemptions via null cap", async () => {
    const admin = await createUser();
    const result = await createAdminDiscountCode({
      issuedByUserId: admin.id,
      kind: "lifetime",
      maxRedemptions: null,
    });
    expect(result.maxRedemptions).toBeNull();
    const row = await getDiscountCode(result.code);
    expect(row?.maxRedemptions).toBeNull();
  });

  it("uses the confusable-free prefixed alphabet", async () => {
    const admin = await createUser();
    const result = await createAdminDiscountCode({
      issuedByUserId: admin.id,
      kind: "day",
      maxRedemptions: 1,
    });
    expect(result.code.startsWith("BB-")).toBe(true);
    // No confusable characters in the random body.
    expect(result.code.slice(3)).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
  });
});

describe("listAdminDiscountCodes", () => {
  it("returns only the caller's admin codes, newest first", async () => {
    const admin = await createUser();
    const other = await createUser();

    const first = await createAdminDiscountCode({
      issuedByUserId: admin.id,
      kind: "day",
      maxRedemptions: 1,
    });
    const second = await createAdminDiscountCode({
      issuedByUserId: admin.id,
      kind: "year",
      maxRedemptions: 2,
    });
    // A different admin's code must not leak into this admin's list.
    await createAdminDiscountCode({
      issuedByUserId: other.id,
      kind: "lifetime",
      maxRedemptions: null,
    });

    const list = await listAdminDiscountCodes(admin.id);
    const codes = list.map((c) => c.code);
    expect(codes).toContain(first.code);
    expect(codes).toContain(second.code);
    expect(codes.length).toBe(2);
    // Newest first: `second` was created after `first`.
    expect(codes[0]).toBe(second.code);
  });

  it("returns an empty list for an admin who has minted nothing", async () => {
    const admin = await createUser();
    const list = await listAdminDiscountCodes(admin.id);
    expect(list).toEqual([]);
  });
});
