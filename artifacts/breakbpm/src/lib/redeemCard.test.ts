import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { redeemUrlFor, cardFilename, passKindLabel } from "./redeemCard";
import { backgroundVariantForKey, BACKGROUND_VARIANTS } from "./backgroundVariants";

function stubOrigin(origin: string): void {
  vi.stubGlobal("window", { location: { origin } });
}

describe("redeemUrlFor", () => {
  beforeEach(() => {
    stubOrigin("https://breakbpm.com");
    vi.stubEnv("BASE_URL", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("joins origin + base path + /redeem/<code> with a root base", () => {
    expect(redeemUrlFor("ABC123")).toBe("https://breakbpm.com/redeem/ABC123");
  });

  it("strips a trailing slash from a non-root BASE_URL", () => {
    vi.stubEnv("BASE_URL", "/app/");
    expect(redeemUrlFor("ABC123")).toBe(
      "https://breakbpm.com/app/redeem/ABC123",
    );
  });

  it("handles a non-root BASE_URL without a trailing slash", () => {
    vi.stubEnv("BASE_URL", "/app");
    expect(redeemUrlFor("ABC123")).toBe(
      "https://breakbpm.com/app/redeem/ABC123",
    );
  });

  it("respects a non-default origin (e.g. dev domain with port)", () => {
    stubOrigin("http://localhost:5173");
    expect(redeemUrlFor("ABC123")).toBe(
      "http://localhost:5173/redeem/ABC123",
    );
  });

  it("URL-encodes codes containing reserved characters", () => {
    expect(redeemUrlFor("a b/c?d#e")).toBe(
      "https://breakbpm.com/redeem/a%20b%2Fc%3Fd%23e",
    );
  });

  it("URL-encodes a code with a percent sign", () => {
    expect(redeemUrlFor("50%OFF")).toBe(
      "https://breakbpm.com/redeem/50%25OFF",
    );
  });
});

describe("cardFilename", () => {
  it("keeps allowed characters (alphanumerics, underscore, hyphen)", () => {
    expect(cardFilename("ABC-123_xyz")).toBe("breakbpm-ABC-123_xyz.png");
  });

  it("strips unsafe characters", () => {
    expect(cardFilename("a b/c?d#e")).toBe("breakbpm-abcde.png");
  });

  it("falls back to 'code' when nothing safe remains", () => {
    expect(cardFilename("!@#$%^&*()")).toBe("breakbpm-code.png");
  });

  it("falls back to 'code' for an empty string", () => {
    expect(cardFilename("")).toBe("breakbpm-code.png");
  });
});

describe("passKindLabel", () => {
  it.each([
    ["day", "DAY PASS"],
    ["twoweek", "14 DAY PASS"],
    ["month", "MONTH PASS"],
    ["year", "YEAR PASS"],
    ["lifetime", "LIFETIME PASS"],
  ])("labels the %s tier", (kind, label) => {
    expect(passKindLabel(kind)).toBe(label);
  });

  it("falls back to 'PASS' for an unknown kind", () => {
    expect(passKindLabel("mystery")).toBe("PASS");
  });

  it("falls back to 'PASS' for an empty string", () => {
    expect(passKindLabel("")).toBe("PASS");
  });
});

// LOCKSTEP: these expected pairs are mirrored in the api-server's
// profileBackground.test.ts. Both implementations must agree so a redeem
// card's artwork matches the recipient's server-resolved watch-profile
// background. If you change the variant order or the hash, update BOTH tests.
describe("backgroundVariantForKey (lockstep with server)", () => {
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
