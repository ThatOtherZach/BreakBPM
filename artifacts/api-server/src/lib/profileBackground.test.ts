import { describe, it, expect } from "vitest";
import {
  backgroundVariantForKey,
  resolveProfileBackground,
  normalizeProfileTheme,
  BACKGROUND_VARIANTS,
} from "./profileBackground";

// LOCKSTEP: these expected pairs are mirrored in the breakbpm client's
// redeemCard.test.ts. Both implementations must agree so a redeem card's
// artwork matches the recipient's server-resolved watch-profile background.
// If you change the variant order or the hash, update BOTH tests.
describe("backgroundVariantForKey (lockstep with client)", () => {
  it.each([
    ["BB-ABC123", "hustler"],
    ["HELLO", "shark"],
    ["abc", "pool-player"],
    ["pass_001", "shark"],
    ["ZZZ-999", "hustler"],
    ["gift-7", "shark"],
    ["lucky", "pool-player"],
    ["u_5f3a9c", "hustler"],
    ["CARD-TEST", "pool-player"],
    ["x", "pool-player"],
  ])("maps %s -> %s", (key, variant) => {
    expect(backgroundVariantForKey(key)).toBe(variant);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(backgroundVariantForKey("  hello  ")).toBe(backgroundVariantForKey("HELLO"));
  });

  it("only ever returns a known variant", () => {
    for (const k of ["", "a", "longer-key-here", "12345"]) {
      expect(BACKGROUND_VARIANTS).toContain(backgroundVariantForKey(k));
    }
  });
});

describe("normalizeProfileTheme", () => {
  it("maps NULL / undefined / unknown to auto", () => {
    expect(normalizeProfileTheme(null)).toBe("auto");
    expect(normalizeProfileTheme(undefined)).toBe("auto");
    expect(normalizeProfileTheme("garbage")).toBe("auto");
  });

  it("passes through known values", () => {
    for (const v of ["auto", "none", "shark", "pool-player", "hustler"] as const) {
      expect(normalizeProfileTheme(v)).toBe(v);
    }
  });
});

describe("resolveProfileBackground", () => {
  it("returns null for unpaid players regardless of theme", () => {
    expect(resolveProfileBackground({ isPaid: false, theme: "shark", deriveKey: "X" })).toBeNull();
    expect(resolveProfileBackground({ isPaid: false, theme: "auto", deriveKey: "X" })).toBeNull();
  });

  it("returns null when the override is 'none'", () => {
    expect(resolveProfileBackground({ isPaid: true, theme: "none", deriveKey: "X" })).toBeNull();
  });

  it("honors an explicit variant override", () => {
    expect(resolveProfileBackground({ isPaid: true, theme: "hustler", deriveKey: "X" })).toBe("hustler");
  });

  it("derives from the key when theme is auto (or NULL)", () => {
    expect(resolveProfileBackground({ isPaid: true, theme: "auto", deriveKey: "HELLO" })).toBe("shark");
    expect(resolveProfileBackground({ isPaid: true, theme: null, deriveKey: "HELLO" })).toBe("shark");
  });
});
