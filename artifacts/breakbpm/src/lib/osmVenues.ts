/**
 * OSM / Overpass billiards-venue fetch service (client-side).
 *
 * This is the ONE module that knows how to turn a map viewport into a set of
 * pool-hall venues from OpenStreetMap. The UI never talks to Overpass directly
 * — it calls {@link fetchOsmVenues} and renders the result. Keeping the source
 * isolated here means a future server-side proxy/cache can replace the body of
 * this module without touching any component.
 *
 * Politeness (the public Overpass instance is donation-run with tight limits):
 *  - We refuse country-scale queries: any bbox wider than {@link MAX_SPAN_DEG}
 *    degrees returns `too-broad` instead of hitting the network.
 *  - The queried bbox is snapped out to a coarse {@link GRID_DEG} grid so small
 *    pans reuse the same cache entry instead of firing a fresh request.
 *  - Results are cached in-memory for {@link CACHE_TTL_MS} (~24h); venue data
 *    barely changes day-to-day, so a long TTL is both correct and the politest
 *    thing for Overpass.
 *  - Each request has a hard {@link REQUEST_TIMEOUT_MS} timeout and never
 *    throws — failures degrade to an `error` status the UI can message.
 *
 * NOTE: browsers forbid setting a custom `User-Agent` header (it's a forbidden
 * header name), so we intentionally do NOT set one — Overpass accepts browser
 * requests with the default UA. A descriptive UA belongs on the future
 * server-side proxy, not here.
 */

export interface OsmVenue {
  /** Stable id of the form "osm:node/123" — namespaced so it never collides
   *  with verified-venue ids when the two sets are merged on the map. */
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** OSM rarely tags table counts; null unless a `tables` tag is present. */
  tableCount: number | null;
  source: "osm";
}

export type OsmFetchResult =
  | { status: "ok"; venues: OsmVenue[] }
  /** The requested bbox was wider than we're willing to query (zoom in). */
  | { status: "too-broad" }
  /** Network/parse/timeout failure — the UI shows a soft "couldn't load". */
  | { status: "error" };

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Minimum Leaflet zoom at which the map should even attempt a venue query. */
export const MIN_VENUE_ZOOM = 10;

/** Hard guard: refuse any bbox whose lat OR lng span exceeds this (degrees). */
const MAX_SPAN_DEG = 3;

/** Coarse grid the queried bbox is snapped to, so small pans hit the cache. */
const GRID_DEG = 0.1;

/** In-memory cache freshness — venue data is near-static day to day. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Per-request hard timeout. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Cap on returned venues so a dense city can't flood the map. */
const MAX_RESULTS = 300;

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

interface CacheEntry {
  at: number;
  venues: OsmVenue[];
}

const cache = new Map<string, CacheEntry>();

/** Snap a value DOWN to the grid. */
function floorToGrid(v: number): number {
  return Math.floor(v / GRID_DEG) * GRID_DEG;
}

/** Snap a value UP to the grid. */
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

/** Build the Overpass QL query for billiards venues in `b`. */
function buildQuery(b: BBox): string {
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  // nwr = node|way|relation in one go; `out center` gives ways/relations a
  // representative lat/lon. Tags per the task spec.
  return `[out:json][timeout:25];
(
  nwr["sport"="billiards"](${bbox});
  nwr["leisure"="adult_gaming_centre"](${bbox});
  nwr["billiards"="yes"](${bbox});
);
out center ${MAX_RESULTS};`;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Map a raw Overpass element to an OsmVenue, or null if unusable/unnamed. */
function toVenue(el: OverpassElement): OsmVenue | null {
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

/** Largest of the two bbox spans, in degrees. */
function bboxSpan(b: BBox): number {
  return Math.max(Math.abs(b.north - b.south), Math.abs(b.east - b.west));
}

/** Combine an optional external abort signal with our per-request timeout. */
function combineSignals(external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (!external) return timeout;
  // AbortSignal.any is supported in all current evergreen browsers.
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([external, timeout]);
  }
  return external.aborted ? external : timeout;
}

/**
 * Fetch billiards venues for a map viewport. Snaps + caches the bbox, refuses
 * over-broad queries, times out, and never throws. Safe to call on every
 * map-move (the caller should still debounce to avoid spamming on drag).
 */
export async function fetchOsmVenues(
  bbox: BBox,
  opts: { signal?: AbortSignal } = {},
): Promise<OsmFetchResult> {
  const snapped = snapBBox(bbox);
  if (bboxSpan(snapped) > MAX_SPAN_DEG) return { status: "too-broad" };

  const key = keyOf(snapped);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { status: "ok", venues: hit.venues };
  }

  try {
    const res = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(buildQuery(snapped))}`,
      signal: combineSignals(opts.signal),
    });
    if (!res.ok) return { status: "error" };
    const json = (await res.json()) as { elements?: OverpassElement[] };
    const seen = new Set<string>();
    const venues: OsmVenue[] = [];
    for (const el of json.elements ?? []) {
      const v = toVenue(el);
      if (!v || seen.has(v.id)) continue;
      seen.add(v.id);
      venues.push(v);
    }
    cache.set(key, { at: Date.now(), venues });
    return { status: "ok", venues };
  } catch {
    // Timeout, abort, network, or parse error — all soft-fail.
    return { status: "error" };
  }
}

/** Test/diagnostic helper — clears the in-memory cache. */
export function __clearOsmVenueCache(): void {
  cache.clear();
}
