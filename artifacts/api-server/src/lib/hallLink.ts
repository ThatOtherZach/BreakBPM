/**
 * Hall/city proximity linking — shared by the game tagging endpoints and the
 * Find Players meetup board.
 *
 * A location (a finalized game's host position, or a meetup post's pin) is
 * "hall-linked" when it sits within {@link HALL_TAG_RADIUS_METERS} of an
 * active Verified Hall, and otherwise falls back to the CITY of the nearest
 * active hall with a known locality within {@link CITY_TAG_RADIUS_METERS}.
 * Using the hall's verbatim, hand-entered locality (never reverse-geocoded
 * text) guarantees the city link always points at a City Leaderboard that
 * actually exists.
 *
 * Meetup cards get one extra tier the game flow doesn't have: when nothing
 * resolves within the city radius, the nearest hall's city within the wider
 * env-configurable "scene" radius is offered as a clearly-labelled
 * "nearest scene" link (see `meetupSceneRadiusKm` in config.ts). Beyond that,
 * no link at all — the 📍 label stays plain text, never a dead link.
 */

import { haversineMeters } from "./geocode";
import { meetupSceneRadiusKm } from "./config";

/** Fixed proximity cap (metres) for hall linking: a game/meetup can only be
 * tied to a Verified Hall the person was/will be physically at.
 * Server-authoritative — client-reported distances are never trusted. */
export const HALL_TAG_RADIUS_METERS = 300;

/** Wider metro cap (metres) for the city fallback: when no Verified Hall is
 * within {@link HALL_TAG_RADIUS_METERS}, the CITY of the nearest active hall
 * whose locality is known can still be linked, as long as that hall is within
 * this radius. Server-authoritative, same as the hall cap. */
export const CITY_TAG_RADIUS_METERS = 50_000;

/** The minimal venue shape the link resolver needs. */
export interface LinkableVenue {
  id: string;
  name: string;
  slug: string | null;
  locality: string | null;
  latitude: number;
  longitude: number;
}

/** The resolved 📍 leaderboard link for a meetup card (API contract shape). */
export interface MeetupLocationLink {
  kind: "hall" | "city";
  /** Hall name (kind=hall) or city locality verbatim (kind=city). */
  label: string;
  /** Slug (or legacy id) for /leaderboard/hall/:slug. Null for city links. */
  hallSlug: string | null;
  /** True when the city link is the OUTER "nearest scene" fallback — beyond
   * the normal city radius but within the capped scene radius — so the UI
   * labels it as the nearest scene rather than the meetup's own city. */
  nearestScene: boolean;
}

/**
 * Find the nearest ACTIVE verified hall within {@link HALL_TAG_RADIUS_METERS}
 * of a point, or null. `venues` must already be filtered to active rows.
 */
export function matchHallForPoint(
  latitude: number,
  longitude: number,
  venues: LinkableVenue[],
): LinkableVenue | null {
  let best: LinkableVenue | null = null;
  let bestDist = Infinity;
  for (const v of venues) {
    const d = haversineMeters(latitude, longitude, v.latitude, v.longitude);
    if (d <= HALL_TAG_RADIUS_METERS && d < bestDist) {
      best = v;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Resolve the 📍 leaderboard link for a meetup post from its TRUE coordinates
 * (call before any privacy redaction — the returned link never contains
 * coordinates, only public hall/city identity).
 *
 *  1. A persisted hall association (still active) → hall link.
 *  2. Nearest active hall with a locality within the 50 km city radius →
 *     city link (same semantics as the game city-tag flow).
 *  3. Nearest active hall's city within the wider env-capped scene radius →
 *     city link flagged `nearestScene`.
 *  4. Otherwise null (plain, non-clickable label).
 */
export function resolveMeetupLocationLink(
  latitude: number,
  longitude: number,
  linkedVenueId: string | null,
  activeVenues: LinkableVenue[],
): MeetupLocationLink | null {
  if (linkedVenueId != null) {
    const hall = activeVenues.find((v) => v.id === linkedVenueId);
    if (hall) {
      return {
        kind: "hall",
        label: hall.name,
        // Legacy pre-slug rows: the hall endpoint resolves ids too.
        hallSlug: hall.slug ?? hall.id,
        nearestScene: false,
      };
    }
    // Linked hall was deactivated/deleted — fall through to the city tiers.
  }
  const sceneRadiusMeters = meetupSceneRadiusKm() * 1000;
  let best: { locality: string; dist: number } | null = null;
  for (const v of activeVenues) {
    if (v.locality == null) continue;
    const d = haversineMeters(latitude, longitude, v.latitude, v.longitude);
    if (d <= sceneRadiusMeters && (best == null || d < best.dist)) {
      best = { locality: v.locality, dist: d };
    }
  }
  if (!best) return null;
  return {
    kind: "city",
    label: best.locality,
    hallSlug: null,
    nearestScene: best.dist > CITY_TAG_RADIUS_METERS,
  };
}
