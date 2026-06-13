/**
 * OSM / Overpass billiards-venue fetch (client-side seam).
 *
 * This is the ONE module the UI uses to turn a map viewport into a set of
 * pool-hall venues. Components never talk to Overpass — they call
 * {@link fetchOsmVenues} and render the result.
 *
 * The actual Overpass work happens on OUR API (`GET /venues/osm`), not here.
 * The browser can't query Overpass reliably itself: it can't set a contact
 * `User-Agent` (a forbidden header), has no shared cache, and Overpass's WAF
 * returns HTTP 406 for the multi-clause union query from residential IPs (the
 * bug that broke the map layer + nearest-hall compass). The server proxy fixes
 * all three — single-clause queries, mirror fallback, a 24h shared cache, and a
 * descriptive UA — and returns the same shape this module exposes.
 *
 * This module keeps a light in-memory cache + the over-broad / min-zoom guards
 * so repeated pans within a session don't re-hit even our own endpoint, and so
 * a country-scale viewport short-circuits before any network call. It never
 * throws — failures degrade to an `error` status the UI can message.
 */

import { listOsmVenues } from "@workspace/api-client-react";

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

/** Per-request hard timeout (a backstop above the server's own budget). */
const REQUEST_TIMEOUT_MS = 20_000;

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
 * Fetch billiards venues for a map viewport via our `/venues/osm` proxy. Snaps
 * + caches the bbox, refuses over-broad queries, times out, and never throws.
 * Safe to call on every map-move (the caller should still debounce to avoid
 * spamming on drag).
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
    const result = await listOsmVenues(
      {
        south: snapped.south,
        west: snapped.west,
        north: snapped.north,
        east: snapped.east,
      },
      { signal: combineSignals(opts.signal) },
    );
    if (result.status === "too_broad") return { status: "too-broad" };
    if (result.status === "error") return { status: "error" };
    // status === "ok" (possibly served from the server's stale cache).
    const venues: OsmVenue[] = result.venues.map((v) => ({
      id: v.id,
      name: v.name,
      latitude: v.latitude,
      longitude: v.longitude,
      tableCount: v.tableCount ?? null,
      source: "osm",
    }));
    cache.set(key, { at: Date.now(), venues });
    return { status: "ok", venues };
  } catch {
    // Non-2xx (e.g. 401/timeout/abort) all soft-fail — customFetch throws on
    // non-2xx, and our endpoint returns 200 for every signed-in outcome.
    return { status: "error" };
  }
}

/** Test/diagnostic helper — clears the in-memory cache. */
export function __clearOsmVenueCache(): void {
  cache.clear();
}
