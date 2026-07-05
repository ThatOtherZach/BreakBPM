import { afterEach, describe, expect, it, vi } from "vitest";

// config.ts logs via pino on malformed env values; stub it so the tests stay
// quiet and don't spin up a real transport.
vi.mock("./logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  HALL_TAG_RADIUS_METERS,
  CITY_TAG_RADIUS_METERS,
  matchHallForPoint,
  resolveMeetupLocationLink,
  type LinkableVenue,
} from "./hallLink";

const ORIGINAL_SCENE = process.env.BREAKBPM_MEETUP_SCENE_RADIUS_KM;

afterEach(() => {
  if (ORIGINAL_SCENE === undefined) delete process.env.BREAKBPM_MEETUP_SCENE_RADIUS_KM;
  else process.env.BREAKBPM_MEETUP_SCENE_RADIUS_KM = ORIGINAL_SCENE;
});

/** ~1° latitude ≈ 111.32 km, so this offsets a point north by `meters`. */
function northOf(lat: number, meters: number): number {
  return lat + meters / 111_320;
}

const BASE = { lat: 43.65, lng: -79.38 }; // Toronto-ish

function venue(overrides: Partial<LinkableVenue> & { id: string }): LinkableVenue {
  return {
    name: `Hall ${overrides.id}`,
    slug: null,
    locality: "Toronto, Canada",
    latitude: BASE.lat,
    longitude: BASE.lng,
    ...overrides,
  };
}

describe("matchHallForPoint", () => {
  it("returns the nearest hall within the 300 m radius", () => {
    const near = venue({ id: "near", latitude: northOf(BASE.lat, 100) });
    const nearer = venue({ id: "nearer", latitude: northOf(BASE.lat, 40) });
    const far = venue({ id: "far", latitude: northOf(BASE.lat, 5_000) });
    expect(matchHallForPoint(BASE.lat, BASE.lng, [near, far, nearer])?.id).toBe("nearer");
  });

  it("returns null when every hall is beyond the radius", () => {
    const far = venue({ id: "far", latitude: northOf(BASE.lat, HALL_TAG_RADIUS_METERS + 200) });
    expect(matchHallForPoint(BASE.lat, BASE.lng, [far])).toBeNull();
  });
});

describe("resolveMeetupLocationLink", () => {
  it("returns a hall link for a persisted, still-active hall association", () => {
    const hall = venue({ id: "v1", slug: "some-hall", name: "Some Hall" });
    const link = resolveMeetupLocationLink(BASE.lat, BASE.lng, "v1", [hall]);
    expect(link).toEqual({
      kind: "hall",
      label: "Some Hall",
      hallSlug: "some-hall",
      nearestScene: false,
    });
  });

  it("falls back to the venue id when the hall has no slug yet", () => {
    const hall = venue({ id: "legacy-id", slug: null });
    const link = resolveMeetupLocationLink(BASE.lat, BASE.lng, "legacy-id", [hall]);
    expect(link?.hallSlug).toBe("legacy-id");
  });

  it("falls through to the city tier when the linked hall is no longer active", () => {
    // Linked venue absent from the active list; another hall 10 km away
    // provides the city.
    const other = venue({ id: "v2", latitude: northOf(BASE.lat, 10_000) });
    const link = resolveMeetupLocationLink(BASE.lat, BASE.lng, "gone", [other]);
    expect(link).toEqual({
      kind: "city",
      label: "Toronto, Canada",
      hallSlug: null,
      nearestScene: false,
    });
  });

  it("links the nearest hall's city within the 50 km city radius", () => {
    const nearCity = venue({ id: "v1", latitude: northOf(BASE.lat, 20_000) });
    const farCity = venue({
      id: "v2",
      locality: "Hamilton, Canada",
      latitude: northOf(BASE.lat, 45_000),
    });
    const link = resolveMeetupLocationLink(BASE.lat, BASE.lng, null, [farCity, nearCity]);
    expect(link).toEqual({
      kind: "city",
      label: "Toronto, Canada",
      hallSlug: null,
      nearestScene: false,
    });
  });

  it("skips halls without a locality when resolving the city", () => {
    const noLocality = venue({ id: "v1", locality: null, latitude: northOf(BASE.lat, 1_000) });
    const withLocality = venue({
      id: "v2",
      locality: "Hamilton, Canada",
      latitude: northOf(BASE.lat, 30_000),
    });
    const link = resolveMeetupLocationLink(BASE.lat, BASE.lng, null, [noLocality, withLocality]);
    expect(link?.label).toBe("Hamilton, Canada");
  });

  it("flags the outer nearest-scene tier beyond the city radius", () => {
    const scene = venue({
      id: "v1",
      locality: "Hamilton, Canada",
      latitude: northOf(BASE.lat, CITY_TAG_RADIUS_METERS + 20_000), // ~70 km
    });
    const link = resolveMeetupLocationLink(BASE.lat, BASE.lng, null, [scene]);
    expect(link).toEqual({
      kind: "city",
      label: "Hamilton, Canada",
      hallSlug: null,
      nearestScene: true,
    });
  });

  it("returns null beyond the scene radius (plain-text label, no dead link)", () => {
    const tooFar = venue({
      id: "v1",
      latitude: northOf(BASE.lat, 150_000), // beyond the default 100 km
    });
    expect(resolveMeetupLocationLink(BASE.lat, BASE.lng, null, [tooFar])).toBeNull();
  });

  it("respects the env-configured scene radius", () => {
    process.env.BREAKBPM_MEETUP_SCENE_RADIUS_KM = "200";
    const scene = venue({ id: "v1", latitude: northOf(BASE.lat, 150_000) });
    const link = resolveMeetupLocationLink(BASE.lat, BASE.lng, null, [scene]);
    expect(link?.nearestScene).toBe(true);

    process.env.BREAKBPM_MEETUP_SCENE_RADIUS_KM = "60";
    expect(resolveMeetupLocationLink(BASE.lat, BASE.lng, null, [scene])).toBeNull();
  });

  it("returns null when there are no active venues at all", () => {
    expect(resolveMeetupLocationLink(BASE.lat, BASE.lng, null, [])).toBeNull();
  });
});
