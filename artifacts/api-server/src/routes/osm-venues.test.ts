import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Mutable test state shared with the auth mock (mirrors venues.test.ts).
const mocks = vi.hoisted(() => ({
  currentUser: null as { id: string } | null,
}));

// Stub auth: the OSM route only calls getOrCreateUser. No DB needed — the
// endpoint just proxies Overpass, which we mock at the fetch layer.
vi.mock("../lib/auth", () => ({
  getVerifiedSubject: vi.fn(async () => mocks.currentUser),
  getOrCreateUser: vi.fn(async () => mocks.currentUser),
  needsOnboarding: vi.fn(() => false),
}));

import venuesRouter from "./venues";
import {
  fetchOsmVenuesForBBox,
  __clearOsmVenueServerCache,
} from "../lib/osmVenues";

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
  app.use("/api", venuesRouter);
  return app;
}

const app = makeApp();

// A small valid viewport (~0.1° span), well under the MAX_SPAN_DEG guard.
const BBOX = "south=40&west=-74&north=40.1&east=-73.9";

interface El {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function ovOk(elements: El[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ elements }),
  } as unknown as Response;
}

function ov406(): Response {
  return {
    ok: false,
    status: 406,
    json: async () => ({}),
  } as unknown as Response;
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  mocks.currentUser = { id: "user-1" };
  __clearOsmVenueServerCache();
});

afterEach(() => {
  fetchSpy.mockRestore();
  vi.clearAllMocks();
  __clearOsmVenueServerCache();
});

describe("GET /venues/osm — auth & validation", () => {
  it("401s a signed-out caller and never touches Overpass", async () => {
    mocks.currentUser = null;
    const res = await request(app).get(`/api/venues/osm?${BBOX}`);
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400s an out-of-range bbox without hitting Overpass", async () => {
    const res = await request(app).get(
      `/api/venues/osm?south=999&west=-74&north=40.1&east=-73.9`,
    );
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400s when a bbox param is missing", async () => {
    const res = await request(app).get(
      `/api/venues/osm?south=40&west=-74&north=40.1`,
    );
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns too_broad for an over-wide bbox without hitting Overpass", async () => {
    // 10° span >> MAX_SPAN_DEG (3).
    const res = await request(app).get(
      `/api/venues/osm?south=30&west=-80&north=40&east=-70`,
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("too_broad");
    expect(res.body.venues).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("GET /venues/osm — Overpass proxying", () => {
  it("returns ok with merged, deduped, named-only venues on success", async () => {
    // The same array is returned for every clause, so node/1 + way/2 each
    // arrive 3× (once per clause) and must dedupe to a single entry apiece.
    fetchSpy.mockResolvedValue(
      ovOk([
        {
          type: "node",
          id: 1,
          lat: 40.05,
          lon: -73.95,
          tags: { name: "Corner Pocket", tables: "8" },
        },
        {
          type: "way",
          id: 2,
          center: { lat: 40.06, lon: -73.96 },
          tags: { name: "Rack 'Em" },
        },
        // Unnamed → noise, must be skipped.
        { type: "node", id: 3, lat: 40.07, lon: -73.97, tags: {} },
      ]),
    );

    const res = await request(app).get(`/api/venues/osm?${BBOX}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");

    const ids = res.body.venues.map((v: { id: string }) => v.id);
    expect(ids).toContain("osm:node/1");
    expect(ids).toContain("osm:way/2");
    expect(ids).not.toContain("osm:node/3");
    expect(ids.filter((i: string) => i === "osm:node/1")).toHaveLength(1);

    const cp = res.body.venues.find((v: { id: string }) => v.id === "osm:node/1");
    expect(cp.tableCount).toBe(8);
    expect(cp.source).toBe("osm");
  });

  it("never sends a union query — one single nwr clause per request, with a contact UA", async () => {
    fetchSpy.mockResolvedValue(ovOk([]));
    await request(app).get(`/api/venues/osm?${BBOX}`);

    expect(fetchSpy).toHaveBeenCalled();
    // Sequential single-clause = exactly one request per clause (3 clauses).
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    for (const call of fetchSpy.mock.calls) {
      const init = call[1] as RequestInit;
      const body = decodeURIComponent(String(init.body).replace(/^data=/, ""));
      // Exactly one nwr clause, no parenthesized union of clauses.
      expect((body.match(/nwr/g) ?? []).length).toBe(1);

      const headers = init.headers as Record<string, string>;
      expect(headers["User-Agent"]).toContain("BreakBPM");
    }
  });

  it("accepts partial clause success when some clauses are WAF-blocked", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        ovOk([{ type: "node", id: 10, lat: 40.05, lon: -73.95, tags: { name: "A" } }]),
      )
      .mockResolvedValueOnce(ov406())
      .mockResolvedValueOnce(ov406());

    const res = await request(app).get(`/api/venues/osm?${BBOX}`);
    expect(res.body.status).toBe("ok");
    expect(res.body.venues.map((v: { id: string }) => v.id)).toEqual(["osm:node/10"]);
  });

  it("falls back to the next mirror when the first is fully blocked", async () => {
    fetchSpy.mockImplementation(async (url) => {
      if (String(url).includes("overpass-api.de")) return ov406();
      if (String(url).includes("kumi.systems")) {
        return ovOk([{ type: "node", id: 20, lat: 40.05, lon: -73.95, tags: { name: "K" } }]);
      }
      return ov406();
    });

    const res = await request(app).get(`/api/venues/osm?${BBOX}`);
    expect(res.body.status).toBe("ok");
    expect(res.body.venues.map((v: { id: string }) => v.id)).toContain("osm:node/20");
  });

  it("returns error when every mirror/clause fails and nothing is cached", async () => {
    fetchSpy.mockResolvedValue(ov406());
    const res = await request(app).get(`/api/venues/osm?${BBOX}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("error");
    expect(res.body.venues).toEqual([]);
  });
});

describe("fetchOsmVenuesForBBox — caching (service-level)", () => {
  const bbox = { south: 40, west: -74, north: 40.1, east: -73.9 };

  it("a second call within the fresh TTL does not re-hit Overpass", async () => {
    fetchSpy.mockResolvedValue(
      ovOk([{ type: "node", id: 40, lat: 40.05, lon: -73.95, tags: { name: "F" } }]),
    );
    await fetchOsmVenuesForBBox(bbox);
    const callsAfterFirst = fetchSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await fetchOsmVenuesForBBox(bbox);
    expect(second.status).toBe("ok");
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("serves a stale cached result on later total upstream failure", async () => {
    // Fake ONLY Date so cache freshness ages, while AbortSignal.timeout (real
    // timers) keeps working and the mocked fetch resolves immediately.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-06-13T00:00:00Z"));
      fetchSpy.mockResolvedValue(
        ovOk([{ type: "node", id: 30, lat: 40.05, lon: -73.95, tags: { name: "S" } }]),
      );
      const fresh = await fetchOsmVenuesForBBox(bbox);
      expect(fresh.status).toBe("ok");
      expect(fresh.stale).toBeUndefined();
      expect(fresh.venues.map((v) => v.id)).toContain("osm:node/30");

      // 25h later: entry is stale (>24h) but within the 7d stale window, and
      // every upstream now fails.
      vi.setSystemTime(new Date("2026-06-14T01:00:00Z"));
      fetchSpy.mockResolvedValue(ov406());
      const stale = await fetchOsmVenuesForBBox(bbox);
      expect(stale.status).toBe("ok");
      expect(stale.stale).toBe(true);
      expect(stale.venues.map((v) => v.id)).toContain("osm:node/30");
    } finally {
      vi.useRealTimers();
    }
  });
});
