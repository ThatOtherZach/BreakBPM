/**
 * Server-side forward geocoding for verified venues.
 *
 * Venue pins were drifting because an admin's hand-typed or roughly-clicked
 * lat/lng rarely matches the venue's real address. The address is the reliable
 * source of truth, so we resolve coordinates from it server-side (authoritative)
 * on create/update and when repairing the existing set.
 *
 * Uses the same free OpenStreetMap Nominatim geocoder the client already uses
 * for Find Players. Nominatim asks callers to send a descriptive User-Agent and
 * to keep requests to ~1/sec — the bulk repair path throttles accordingly.
 */

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "BreakBPM/1.0 (venue geocoding; +https://breakbpm.com)";

export type GeoPoint = { lat: number; lng: number };

/**
 * Resolve a street address (optionally disambiguated by a locality) into WGS84
 * coordinates. Returns null on a blank address, no match, a non-2xx/timeout, or
 * out-of-range coordinates — callers must treat null as "couldn't locate" and
 * never substitute a wrong point.
 */
export async function geocodeAddress(
  address: string,
  locality?: string | null,
  opts: { timeoutMs?: number } = {},
): Promise<GeoPoint | null> {
  const addr = address.trim();
  if (!addr) return null;

  const query = [addr, (locality ?? "").trim()].filter(Boolean).join(", ");
  const url = `${NOMINATIM_SEARCH_URL}?format=json&limit=1&q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const hit = Array.isArray(data) ? data[0] : undefined;
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
    return { lat, lng };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Great-circle distance between two WGS84 points, in metres. */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
