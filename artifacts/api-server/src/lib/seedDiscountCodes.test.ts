import { describe, it, expect, vi } from "vitest";

// The parser warns on malformed entries via the pino logger. Stub it so the
// tests don't spin up a real transport (and so we can assert it stays quiet on
// valid input).
vi.mock("./logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { parseCompCodes } from "./seedDiscountCodes";

describe("parseCompCodes", () => {
  it("returns [] for unset / blank input", () => {
    expect(parseCompCodes(undefined)).toEqual([]);
    expect(parseCompCodes("")).toEqual([]);
    expect(parseCompCodes("   ")).toEqual([]);
  });

  it("parses a single entry with an explicit cap", () => {
    expect(parseCompCodes("LIFE-A7BHS2:lifetime:1")).toEqual([
      { code: "LIFE-A7BHS2", grantsPassKind: "lifetime", maxRedemptions: 1 },
    ]);
  });

  it("treats an omitted cap as unlimited (null)", () => {
    expect(parseCompCodes("FREEBIE:day")).toEqual([
      { code: "FREEBIE", grantsPassKind: "day", maxRedemptions: null },
    ]);
  });

  it("parses multiple comma-separated entries and tolerates whitespace", () => {
    expect(
      parseCompCodes(" LIFE-A:lifetime:1 , BREAKBPM-LIFETIME : lifetime : 500 "),
    ).toEqual([
      { code: "LIFE-A", grantsPassKind: "lifetime", maxRedemptions: 1 },
      { code: "BREAKBPM-LIFETIME", grantsPassKind: "lifetime", maxRedemptions: 500 },
    ]);
  });

  it("uppercases the code to match redeem lookup semantics", () => {
    expect(parseCompCodes("life-lower:lifetime")).toEqual([
      { code: "LIFE-LOWER", grantsPassKind: "lifetime", maxRedemptions: null },
    ]);
  });

  it("skips malformed entries but keeps the valid ones", () => {
    expect(
      parseCompCodes(
        "GOOD:lifetime:1,BADKIND:platinum,NOCODE:,:lifetime,EXTRA:day:1:oops,ALSO:day",
      ),
    ).toEqual([
      { code: "GOOD", grantsPassKind: "lifetime", maxRedemptions: 1 },
      { code: "ALSO", grantsPassKind: "day", maxRedemptions: null },
    ]);
  });

  it("rejects non-positive / non-integer caps", () => {
    expect(parseCompCodes("A:day:0,B:day:-1,C:day:1.5,D:day:abc")).toEqual([]);
  });
});
