import { describe, it, expect } from "vitest";
import {
  randomBackgroundVariant,
  coerceBackgroundVariant,
  resolveProfileBackground,
  normalizeProfileTheme,
  BACKGROUND_VARIANTS,
} from "./profileBackground";

describe("randomBackgroundVariant", () => {
  it("only ever returns a known variant", () => {
    for (let i = 0; i < 50; i++) {
      expect(BACKGROUND_VARIANTS).toContain(randomBackgroundVariant());
    }
  });
});

describe("coerceBackgroundVariant", () => {
  it("passes through known variants", () => {
    for (const v of BACKGROUND_VARIANTS) {
      expect(coerceBackgroundVariant(v)).toBe(v);
    }
  });

  it("maps NULL / undefined / unknown to null", () => {
    expect(coerceBackgroundVariant(null)).toBeNull();
    expect(coerceBackgroundVariant(undefined)).toBeNull();
    expect(coerceBackgroundVariant("garbage")).toBeNull();
    expect(coerceBackgroundVariant("")).toBeNull();
    expect(coerceBackgroundVariant("auto")).toBeNull();
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
    expect(resolveProfileBackground({ isPaid: false, theme: "shark", cardVariant: "shark" })).toBeNull();
    expect(resolveProfileBackground({ isPaid: false, theme: "auto", cardVariant: "shark" })).toBeNull();
  });

  it("returns null when the override is 'none' (opt-out beats card + earned)", () => {
    expect(resolveProfileBackground({ isPaid: true, theme: "none", cardVariant: "shark" })).toBeNull();
    expect(
      resolveProfileBackground({
        isPaid: true,
        theme: "none",
        cardVariant: "shark",
        earnedVariant: "hustler",
      }),
    ).toBeNull();
  });

  it("honors an explicit variant override (beats the stored card variant)", () => {
    expect(
      resolveProfileBackground({ isPaid: true, theme: "hustler", cardVariant: "shark" }),
    ).toBe("hustler");
  });

  it("uses the card's stored variant when theme is auto (or NULL)", () => {
    expect(resolveProfileBackground({ isPaid: true, theme: "auto", cardVariant: "pool-player" })).toBe(
      "pool-player",
    );
    expect(resolveProfileBackground({ isPaid: true, theme: null, cardVariant: "shark" })).toBe("shark");
  });

  it("prefers the card's stored variant over an auto-earned theme (auto)", () => {
    // A paid player with both a card AND a qualifying game-history streak wears
    // the deliberate card artwork, not the auto-earned one.
    expect(
      resolveProfileBackground({
        isPaid: true,
        theme: "auto",
        cardVariant: "pool-player",
        earnedVariant: "shark",
      }),
    ).toBe("pool-player");
  });

  it("falls back to an auto-earned theme when a paid player has no card (auto)", () => {
    // Crypto / grant / admin effective-Lifetime: no card stored, but recent game
    // history earned a theme → wear the earned one.
    expect(
      resolveProfileBackground({
        isPaid: true,
        theme: "auto",
        cardVariant: null,
        earnedVariant: "hustler",
      }),
    ).toBe("hustler");
  });

  it("falls back to plain (null) when auto has neither a card nor an earned variant", () => {
    // A pass whose card carried no artwork (crypto / grant / artwork-disabled)
    // and no qualifying game history → plain.
    expect(resolveProfileBackground({ isPaid: true, theme: "auto", cardVariant: null })).toBeNull();
    expect(resolveProfileBackground({ isPaid: true, theme: null, cardVariant: null })).toBeNull();
  });
});
