import { describe, it, expect } from "vitest";
import type { CryptoDayPassPricing } from "@workspace/api-client-react";
import { computeDayPassPriceCents } from "./dayPassPricing";

// Mirrors the server DAY_PASS_PRICING defaults — these tests pin the shared
// formula so the client estimate and the server-frozen quote stay in lockstep.
const PARAMS: CryptoDayPassPricing = {
  minDays: 1,
  maxDays: 365,
  firstDayCents: 199,
  midRateCents: 10,
  midThreshold: 30,
  longRateCents: 3,
};

describe("computeDayPassPriceCents", () => {
  it("anchors the first day at the flat fee", () => {
    expect(computeDayPassPriceCents(1, PARAMS)).toBe(199);
  });

  it("adds the mid rate per day up to the threshold", () => {
    expect(computeDayPassPriceCents(7, PARAMS)).toBe(259);
    expect(computeDayPassPriceCents(30, PARAMS)).toBe(489);
  });

  it("switches to the cheaper long rate beyond the threshold", () => {
    expect(computeDayPassPriceCents(31, PARAMS)).toBe(492);
    expect(computeDayPassPriceCents(365, PARAMS)).toBe(1494);
  });

  it("is monotonic — each extra day never lowers the price", () => {
    for (let d = PARAMS.minDays; d < PARAMS.maxDays; d++) {
      expect(computeDayPassPriceCents(d + 1, PARAMS)).toBeGreaterThanOrEqual(
        computeDayPassPriceCents(d, PARAMS),
      );
    }
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(computeDayPassPriceCents(0, PARAMS)).toBe(199);
    expect(computeDayPassPriceCents(-5, PARAMS)).toBe(199);
    expect(computeDayPassPriceCents(1000, PARAMS)).toBe(1494);
  });

  it("floors fractional days", () => {
    expect(computeDayPassPriceCents(7.9, PARAMS)).toBe(259);
  });
});
