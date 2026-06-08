import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// fx.ts caches in module scope, so re-import a fresh copy per test to isolate
// the in-memory today/last-good/historical caches.
async function freshFx() {
  vi.resetModules();
  return import("./fx");
}

function bocResponse(obs: Array<{ d: string; v: string | null }>) {
  return {
    ok: true,
    json: async () => ({
      observations: obs.map((o) => ({
        d: o.d,
        FXUSDCAD: o.v === null ? {} : { v: o.v },
      })),
    }),
  };
}

describe("convertUsdToCad (pure)", () => {
  it("scales USD cents by the micro rate and rounds", async () => {
    const { convertUsdToCad } = await freshFx();
    expect(convertUsdToCad(499, 1_000_000)).toBe(499); // rate 1.0 → unchanged
    expect(convertUsdToCad(499, 1_350_000)).toBe(Math.round((499 * 1_350_000) / 1e6));
    expect(convertUsdToCad(0, 1_350_000)).toBe(0);
  });
});

describe("getUsdToCadRate (today)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.BREAKBPM_USD_CAD_FALLBACK_RATE;
  });

  it("parses the latest BoC observation into scaled micros", async () => {
    fetchSpy.mockResolvedValue(
      bocResponse([{ d: "2026-06-05", v: "1.3712" }]) as unknown as Response,
    );
    const { getUsdToCadRate } = await freshFx();
    const rate = await getUsdToCadRate();
    expect(rate.rateMicros).toBe(1_371_200);
    expect(rate.rateDate).toBe("2026-06-05");
    expect(rate.source).toBe("bank_of_canada");
  });

  it("caches: a second call within the TTL does not re-fetch", async () => {
    fetchSpy.mockResolvedValue(
      bocResponse([{ d: "2026-06-05", v: "1.30" }]) as unknown as Response,
    );
    const { getUsdToCadRate } = await freshFx();
    await getUsdToCadRate();
    await getUsdToCadRate();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to the env rate when BoC is unreachable", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));
    process.env.BREAKBPM_USD_CAD_FALLBACK_RATE = "1.40";
    const { getUsdToCadRate } = await freshFx();
    const rate = await getUsdToCadRate();
    expect(rate.rateMicros).toBe(1_400_000);
    expect(rate.source).toBe("fallback");
  });

  it("falls back to the hardcoded default when BoC fails and no env override", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 503 } as unknown as Response);
    const { getUsdToCadRate } = await freshFx();
    const rate = await getUsdToCadRate();
    expect(rate.rateMicros).toBe(1_370_000);
    expect(rate.source).toBe("fallback");
  });

  it("never throws on malformed observations (skips, then falls back)", async () => {
    fetchSpy.mockResolvedValue(
      bocResponse([{ d: "2026-06-05", v: null }]) as unknown as Response,
    );
    const { getUsdToCadRate } = await freshFx();
    const rate = await getUsdToCadRate();
    expect(rate.source).toBe("fallback");
  });
});

describe("getUsdToCadRateForDate (historical)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => fetchSpy.mockRestore());

  it("picks the most recent observation on or before the target date", async () => {
    // BoC returns ascending; the target may be a weekend, so the last business
    // day before it is the right pick (latest usable in the window).
    fetchSpy.mockResolvedValue(
      bocResponse([
        { d: "2026-03-05", v: "1.41" },
        { d: "2026-03-06", v: "1.42" },
      ]) as unknown as Response,
    );
    const { getUsdToCadRateForDate } = await freshFx();
    const rate = await getUsdToCadRateForDate(new Date("2026-03-08T00:00:00Z"));
    expect(rate.rateMicros).toBe(1_420_000);
    expect(rate.rateDate).toBe("2026-03-06");
    expect(rate.source).toBe("bank_of_canada");
  });

  it("caches per target date", async () => {
    fetchSpy.mockResolvedValue(
      bocResponse([{ d: "2026-03-06", v: "1.42" }]) as unknown as Response,
    );
    const { getUsdToCadRateForDate } = await freshFx();
    const d = new Date("2026-03-08T00:00:00Z");
    await getUsdToCadRateForDate(d);
    await getUsdToCadRateForDate(d);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
