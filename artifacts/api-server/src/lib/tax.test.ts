import { describe, it, expect } from "vitest";
import {
  computeTaxInclusive,
  GST_RATE_BPS,
  PST_RATE_BPS,
} from "./tax";

describe("computeTaxInclusive", () => {
  it("always sums gst + pst + net back to the gross", () => {
    const grosses = [
      0, 1, 2, 99, 100, 199, 499, 599, 1499, 2499, 12345, 99999, 1_000_000,
    ];
    for (const gross of grosses) {
      const { gstCents, pstCents, netCents } = computeTaxInclusive(gross);
      expect(gstCents + pstCents + netCents).toBe(gross);
    }
  });

  it("returns all zeros for a $0 comp", () => {
    expect(computeTaxInclusive(0)).toEqual({
      gstCents: 0,
      pstCents: 0,
      netCents: 0,
      gstRateBps: GST_RATE_BPS,
      pstRateBps: PST_RATE_BPS,
    });
  });

  it("backs tax out of a tax-inclusive gross (5% GST + 7% PST)", () => {
    // $5.99 gross → gst = round(599*5/112)=27, pst = round(599*7/112)=37,
    // net = 599 - 27 - 37 = 535.
    expect(computeTaxInclusive(599)).toEqual({
      gstCents: 27,
      pstCents: 37,
      netCents: 535,
      gstRateBps: 500,
      pstRateBps: 700,
    });
  });

  it("reports the rates it applied", () => {
    const { gstRateBps, pstRateBps } = computeTaxInclusive(2499);
    expect(gstRateBps).toBe(500);
    expect(pstRateBps).toBe(700);
  });
});
