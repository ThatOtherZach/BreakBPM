import { logger } from "./logger";

/**
 * OSM / Overpass billiards-venue proxy + cache (server-side).
 *
 * The browser cannot query Overpass directly in a reliable, polite way:
 *  - it can't set a contact `User-Agent` (a forbidden request header), and
 *  - Overpass's WAF (mod_security) rejects the multi-clause UNION query with
 *    HTTP 406 from many residential IPs, which is exactly what broke the map's
 *    OSM layer and the nearest-hall compass.
 *
 * So the API does it instead, with the reliability levers a browser lacks:
 *  - a descriptive contact `User-Agent` (Overpass etiquette),
 *  - SINGLE-clause queries (never the 406-prone union) run sequentially and
 *    merged/deduped server-side; a partial success (some clauses 200, some not)
 *    is still returned rather than failing the whole layer,
 *  - mirror fallback across the public Overpass instances,
 *  - a 24h fresh cache + 7d stale-if-error cache keyed by a snapped bbox, so
 *    Overpass is hit roughly once per region per day (the volume cap that keeps
 *    a shared egress IP from being reputation-throttled), and
 *  - in-flight coalescing so concurrent callers for the same bbox share one
 *    upstream round-trip.
 *
 * Every path resolves — it never throws. The caller (the route) maps the result
 * straight onto the OsmVenueList contract.
 */

export interface ServerOsmVenue {
  /** Namespaced id e.g. "osm:node/123" so it never collides with verified ids. */
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** OSM rarely tags table counts; null unless a `tables` tag is present. */
  tableCount: number | null;
  source: "osm";
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export type OsmVenueResult =
  | { status: "ok"; venues: ServerOsmVenue[]; stale?: boolean }
  | { status: "too_broad"; venues: [] }
  | { status: "error"; venues: [] };

/** Hard guard: refuse any bbox whose lat OR lng span exceeds this (degrees). */
const MAX_SPAN_DEG = 3;
/** Coarse grid the queried bbox is snapped to, so small pans hit the cache. */
const GRID_DEG = 0.1;
/** Fresh-cache window — venue data is near-static day to day. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** How long a cached result may still be served on total upstream failure. */
const STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Cap on returned venues so a dense city can't flood the map. */
const MAX_RESULTS = 300;
/** Whole-request deadline across all mirrors/clauses. */
const OVERALL_BUDGET_MS = 15_000;
/** Per single-clause upstream timeout (further clamped by remaining budget). */
const PER_CLAUSE_TIMEOUT_MS = 7_000;

/** Contact UA per Overpass etiquette — lets operators reach us before banning. */
const USER_AGENT = "BreakBPM/1.0 (+https://breakbpm.com; pool-hall map)";

/**
 * Public Overpass mirrors, tried in order. We only move to the next mirror when
 * the current one yields NO successful clause (hard-down / fully WAF-blocked).
 */
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

/**
 * The billiards tag clauses, each issued as its OWN single-clause query (the
 * parenthesized union of these is what trips Overpass's WAF). `out center`
 * gives ways/relations a representative point.
 */
const CLAUSES = [
  '["sport"="billiards"]',
  '["leisure"="adult_gaming_centre"]',
  '["billiards"="yes"]',
];

interface CacheEntry {
  at: number;
  venues: ServerOsmVenue[];
}
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<OsmVenueResult>>();

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function floorToGrid(v: number): number {
  return Math.floor(v / GRID_DEG) * GRID_DEG;
}
function ceilToGrid(v: number): number {
  return Math.ceil(v / GRID_DEG) * GRID_DEG;
}

/** Expand a bbox out to the coarse grid so nearby viewports share a key. */
function snapBBox(b: BBox): BBox {
  return {
    south: floorToGrid(b.south),
    west: floorToGrid(b.west),
    north: ceilToGrid(b.north),
    east: ceilToGrid(b.east),
  };
}

/** Round to 3 decimals for a stable cache key (grid is 0.1, so 3dp is exact). */
function keyOf(b: BBox): string {
  const r = (n: number) => n.toFixed(3);
  return `${r(b.south)},${r(b.west)},${r(b.north)},${r(b.east)}`;
}

/** Largest of the two bbox spans, in degrees. */
function bboxSpan(b: BBox): number {
  return Math.max(Math.abs(b.north - b.south), Math.abs(b.east - b.west));
}

/** Map a raw Overpass element to a venue, or null if unusable/unnamed. */
function toVenue(el: OverpassElement): ServerOsmVenue | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const tags = el.tags ?? {};
  const name = tags.name?.trim();
  // Unnamed venues are noise on the map and useless in a popup — skip them.
  if (!name) return null;
  const rawTables = tags.tables ?? tags["billiard:tables"];
  const parsedTables = rawTables != null ? Number.parseInt(rawTables, 10) : NaN;
  return {
    id: `osm:${el.type}/${el.id}`,
    name,
    latitude: lat,
    longitude: lon,
    tableCount: Number.isFinite(parsedTables) ? parsedTables : null,
    source: "osm",
  };
}

/** Build a single-clause Overpass QL query for `clause` within `b`. */
function buildClauseQuery(clause: string, b: BBox): string {
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:25];nwr${clause}(${bbox});out center ${MAX_RESULTS};`;
}

/**
 * Run ONE clause against ONE mirror. Returns parsed elements on a 200 + JSON
 * (even an empty array — a legitimate "nothing here"), or null on any
 * non-2xx / timeout / network / parse failure.
 */
async function runClause(
  mirror: string,
  clause: string,
  bbox: BBox,
  deadline: number,
): Promise<OverpassElement[] | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return null;
  try {
    const res = await fetch(mirror, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      body: `data=${encodeURIComponent(buildClauseQuery(clause, bbox))}`,
      signal: AbortSignal.timeout(Math.min(PER_CLAUSE_TIMEOUT_MS, remaining)),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { elements?: OverpassElement[] };
    return json.elements ?? [];
  } catch {
    return null;
  }
}

/**
 * Query a mirror across all clauses (sequentially, to respect the 2-slot
 * limit), merging/deduping results. Returns the merged venues if AT LEAST ONE
 * clause succeeded (partial success is fine), else null so the caller falls
 * through to the next mirror.
 */
async function queryMirror(
  mirror: string,
  bbox: BBox,
  deadline: number,
): Promise<ServerOsmVenue[] | null> {
  let anySuccess = false;
  const merged = new Map<string, ServerOsmVenue>();
  for (const clause of CLAUSES) {
    if (Date.now() >= deadline) break;
    const els = await runClause(mirror, clause, bbox, deadline);
    if (els === null) continue;
    anySuccess = true;
    for (const el of els) {
      const v = toVenue(el);
      if (v) merged.set(v.id, v);
    }
  }
  return anySuccess ? [...merged.values()] : null;
}

/** Walk the mirrors until one yields a (possibly partial) result, or budget runs out. */
async function fetchFromUpstream(
  bbox: BBox,
  deadline: number,
): Promise<ServerOsmVenue[] | null> {
  for (const mirror of MIRRORS) {
    if (Date.now() >= deadline) break;
    const venues = await queryMirror(mirror, bbox, deadline);
    if (venues !== null) return venues.slice(0, MAX_RESULTS);
  }
  return null;
}

/**
 * Resolve billiards venues for a viewport. Snaps + caches the bbox, refuses
 * over-broad queries, bounds total time, and never throws.
 *  - fresh cache hit → ok
 *  - over-broad → too_broad
 *  - upstream ok → ok (cached)
 *  - upstream total failure → stale cache (ok + stale:true) if recent, else error
 */
export function fetchOsmVenuesForBBox(bbox: BBox): Promise<OsmVenueResult> {
  const snapped = snapBBox(bbox);
  if (bboxSpan(snapped) > MAX_SPAN_DEG) {
    return Promise.resolve({ status: "too_broad", venues: [] });
  }

  const key = keyOf(snapped);
  const fresh = cache.get(key);
  if (fresh && Date.now() - fresh.at < CACHE_TTL_MS) {
    return Promise.resolve({ status: "ok", venues: fresh.venues });
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const run = (async (): Promise<OsmVenueResult> => {
    const deadline = Date.now() + OVERALL_BUDGET_MS;
    const venues = await fetchFromUpstream(snapped, deadline);
    if (venues !== null) {
      cache.set(key, { at: Date.now(), venues });
      return { status: "ok", venues };
    }
    // Total failure: serve a recent cached result rather than nothing.
    const stale = cache.get(key);
    if (stale && Date.now() - stale.at < STALE_TTL_MS) {
      logger.warn({ key }, "OSM venues: all upstreams failed, serving stale cache");
      return { status: "ok", venues: stale.venues, stale: true };
    }
    logger.warn({ key }, "OSM venues: all upstreams failed, no cache to serve");
    return { status: "error", venues: [] };
  })();

  inflight.set(key, run);
  return run.finally(() => inflight.delete(key));
}

/** Test/diagnostic helper — clears the in-memory caches. */
export function __clearOsmVenueServerCache(): void {
  cache.clear();
  inflight.clear();
}
