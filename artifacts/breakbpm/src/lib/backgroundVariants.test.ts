import { describe, it, expect } from "vitest";
import { themeColorOf, THEME_FELT, THEME_ACCENT, THEME_DOT } from "./backgroundVariants";

describe("themeColorOf", () => {
  it("maps shark → blue", () => {
    expect(themeColorOf("shark")).toBe("blue");
  });

  it("maps hustler → red", () => {
    expect(themeColorOf("hustler")).toBe("red");
  });

  it("maps pool-player → purple", () => {
    expect(themeColorOf("pool-player")).toBe("purple");
  });

  it("maps none → green", () => {
    expect(themeColorOf("none")).toBe("green");
  });

  it("maps null → green", () => {
    expect(themeColorOf(null)).toBe("green");
  });

  it("maps undefined → green", () => {
    expect(themeColorOf(undefined)).toBe("green");
  });

  it("maps unknown string → green", () => {
    expect(themeColorOf("something-else")).toBe("green");
  });
});

const THEME_KEYS = ["shark", "hustler", "pool-player", null] as const;

describe("THEME_FELT distinctness", () => {
  it("all four themes map to distinct felt colors", () => {
    const felts = THEME_KEYS.map((k) => THEME_FELT[themeColorOf(k)].felt);
    expect(new Set(felts).size).toBe(4);
  });

  it("all four themes map to distinct feltShadow colors", () => {
    const shadows = THEME_KEYS.map((k) => THEME_FELT[themeColorOf(k)].feltShadow);
    expect(new Set(shadows).size).toBe(4);
  });

  it("all four themes map to distinct feltFade colors", () => {
    const fades = THEME_KEYS.map((k) => THEME_FELT[themeColorOf(k)].feltFade);
    expect(new Set(fades).size).toBe(4);
  });
});

describe("THEME_ACCENT distinctness", () => {
  it("all four themes map to distinct accent colors", () => {
    const accents = THEME_KEYS.map((k) => THEME_ACCENT[themeColorOf(k)]);
    expect(new Set(accents).size).toBe(4);
  });
});

describe("THEME_DOT distinctness", () => {
  it("all four themes map to distinct dot glyphs", () => {
    const dots = THEME_KEYS.map((k) => THEME_DOT[themeColorOf(k)]);
    expect(new Set(dots).size).toBe(4);
  });
});
