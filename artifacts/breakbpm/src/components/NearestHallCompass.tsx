/**
 * Nearest-hall 8-ball compass. Points an 8-ball needle at the closest pool
 * hall to the user's current location, with a live distance readout.
 *
 * Critical safety rule (see task spec): the candidate set is VENUES ONLY —
 * OSM + admin-verified halls. Meetup posts are NEVER fed in. Pointing a
 * bearing/distance at a person's meetup would be a doxxing vector and a
 * side-channel that could let a free user triangulate the precise meetup
 * coordinates we deliberately hide from them.
 *
 * Heading: uses the device compass where available (iOS needs an explicit
 * `DeviceOrientationEvent.requestPermission()` from a user gesture, which is
 * why the whole flow is started by a button tap). When no live heading is
 * available it falls back to a static north-up bearing and says so.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Venue } from "@workspace/api-client-react";
import { bearingDeg, haversineKm, type LatLng } from "../lib/geo";
import { fetchOsmVenues, type OsmVenue } from "../lib/osmVenues";

/** Beyond this, we show a friendly "no halls nearby" state, not a far arrow. */
const MAX_HALL_KM = 100;

/** Half-width (degrees) of the bbox we query around the user for OSM halls. */
const SEARCH_HALF_DEG = 1.0;

type Phase =
  | "idle"
  | "locating"
  | "geo-denied"
  | "loading"
  | "load-error"
  | "no-halls"
  | "ready";

interface NearestHall {
  name: string;
  coords: LatLng;
  distanceKm: number;
  verified: boolean;
}

type OrientEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

export default function NearestHallCompass({
  verifiedVenues,
  onExit,
}: {
  verifiedVenues: Venue[];
  onExit: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [user, setUser] = useState<LatLng | null>(null);
  const [nearest, setNearest] = useState<NearestHall | null>(null);
  /** Live device compass heading (clockwise from north), or null if none. */
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Tear down the orientation listener on unmount.
  useEffect(() => () => cleanupRef.current?.(), []);

  const computeNearest = useCallback(
    (origin: LatLng, osm: OsmVenue[]): NearestHall | null => {
      const candidates: NearestHall[] = [];
      for (const v of verifiedVenues) {
        candidates.push({
          name: v.name,
          coords: [v.latitude, v.longitude],
          distanceKm: haversineKm(origin, [v.latitude, v.longitude]),
          verified: true,
        });
      }
      for (const v of osm) {
        candidates.push({
          name: v.name,
          coords: [v.latitude, v.longitude],
          distanceKm: haversineKm(origin, [v.latitude, v.longitude]),
          verified: false,
        });
      }
      if (candidates.length === 0) return null;
      // Closest first; verified wins an effective tie.
      candidates.sort(
        (a, b) =>
          a.distanceKm - b.distanceKm || Number(b.verified) - Number(a.verified),
      );
      return candidates[0];
    },
    [verifiedVenues],
  );

  const startHeadingUpdates = useCallback(async () => {
    // iOS 13+ gates orientation behind an explicit permission prompt that MUST
    // be triggered from a user gesture (this runs inside the button handler).
    const DOE = window.DeviceOrientationEvent as
      | (typeof DeviceOrientationEvent & {
          requestPermission?: () => Promise<"granted" | "denied">;
        })
      | undefined;
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        const res = await DOE.requestPermission();
        if (res !== "granted") return; // fall back to static north-up bearing
      } catch {
        return;
      }
    }
    const onOrient = (raw: Event) => {
      const e = raw as OrientEvent;
      let h: number | null = null;
      if (typeof e.webkitCompassHeading === "number") {
        h = e.webkitCompassHeading; // already clockwise from true north
      } else if (e.absolute && e.alpha != null) {
        h = (360 - e.alpha) % 360;
      }
      if (h != null && Number.isFinite(h)) setDeviceHeading(h);
    };
    const evtName =
      "ondeviceorientationabsolute" in window
        ? "deviceorientationabsolute"
        : "deviceorientation";
    window.addEventListener(evtName, onOrient, true);
    cleanupRef.current = () =>
      window.removeEventListener(evtName, onOrient, true);
  }, []);

  const start = useCallback(() => {
    if (!navigator.geolocation) {
      setPhase("geo-denied");
      return;
    }
    setPhase("locating");
    // Kick off the (gesture-bound) orientation permission right away.
    void startHeadingUpdates();
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const origin: LatLng = [pos.coords.latitude, pos.coords.longitude];
        setUser(origin);
        setPhase("loading");
        const res = await fetchOsmVenues({
          south: origin[0] - SEARCH_HALF_DEG,
          north: origin[0] + SEARCH_HALF_DEG,
          west: origin[1] - SEARCH_HALF_DEG,
          east: origin[1] + SEARCH_HALF_DEG,
        });
        // Even if OSM fails, verified venues alone can still answer.
        const osm = res.status === "ok" ? res.venues : [];
        const best = computeNearest(origin, osm);
        if (!best) {
          setPhase(res.status === "error" ? "load-error" : "no-halls");
          return;
        }
        setNearest(best);
        setPhase(best.distanceKm > MAX_HALL_KM ? "no-halls" : "ready");
      },
      () => setPhase("geo-denied"),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }, [computeNearest, startHeadingUpdates]);

  const distanceLabel = (km: number): string =>
    km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`;

  // Static great-circle bearing from the user to the venue (from true north).
  const targetBearing =
    user && nearest ? bearingDeg(user, nearest.coords) : 0;
  // Needle points at the venue relative to where the device faces. With no
  // live compass, deviceHeading is null → rotation = targetBearing (north-up).
  const needleRotation = targetBearing - (deviceHeading ?? 0);

  return (
    <div className="fpp-compass">
      <div className="fpp-compass-head">
        <span className="fpp-compass-title">🎱 NEAREST HALL</span>
        <button className="btn fpp-compass-exit" onClick={onExit}>
          ✕ Close
        </button>
      </div>
      {phase === "idle" && (
        <div className="fpp-compass-body">
          <p className="fpp-hint text-[#fff] border-t-[#fff] border-r-[#fff] border-b-[#fff] border-l-[#fff]">
            Point your phone and we'll aim an 8-ball at the closest pool hall.
            We'll ask for your location and compass.
          </p>
          <button className="btn btn-primary btn-big" onClick={start}>
            Find the nearest hall
          </button>
        </div>
      )}
      {phase === "locating" && (
        <p className="fpp-hint fpp-compass-body">📍 Getting your location…</p>
      )}
      {phase === "loading" && (
        <p className="fpp-hint fpp-compass-body">🔎 Looking for pool halls…</p>
      )}
      {phase === "geo-denied" && (
        <div className="fpp-compass-body">
          <p className="fpp-error">
            Location is needed to find the nearest hall. Enable location access
            and try again.
          </p>
          <button className="btn btn-primary" onClick={start}>
            Try again
          </button>
        </div>
      )}
      {phase === "load-error" && (
        <div className="fpp-compass-body">
          <p className="fpp-error">
            Couldn't reach the venue map. Check your connection and try again.
          </p>
          <button className="btn btn-primary" onClick={start}>
            Try again
          </button>
        </div>
      )}
      {phase === "no-halls" && (
        <div className="fpp-compass-body">
          <p className="fpp-empty">
            No pool halls within {MAX_HALL_KM} km of you
            {nearest ? ` (nearest is ${distanceLabel(nearest.distanceKm)} away)` : ""}.
          </p>
          <button className="btn" onClick={start}>
            Search again
          </button>
        </div>
      )}
      {phase === "ready" && nearest && (
        <div className="fpp-compass-body">
          <div
            className="fpp-compass-dial"
            role="img"
            aria-label={`Compass pointing to ${nearest.name}, ${distanceLabel(
              nearest.distanceKm,
            )} away`}
          >
            <span className="fpp-compass-n">N</span>
            <div
              className="fpp-compass-needle"
              style={{ transform: `rotate(${needleRotation}deg)` }}
            >
              <span className="fpp-compass-arrow" aria-hidden="true" />
              <span
                className="hud-chip hud-chip-eight fpp-compass-ball"
                data-number="8"
                aria-hidden="true"
              />
            </div>
          </div>
          <div className="fpp-compass-readout">
            <div className="fpp-compass-venue">
              {nearest.verified && (
                <span className="fpp-verified-badge" title="Verified hall">
                  ✓
                </span>
              )}
              {nearest.name}
            </div>
            <div className="fpp-compass-dist">{distanceLabel(nearest.distanceKm)}</div>
          </div>
          <p className="fpp-compass-mode">
            {deviceHeading != null
              ? "Live compass — turn until the 8-ball points up."
              : "North-up bearing (no live compass on this device)."}
          </p>
          <p className="fpp-attribution">Venue data © OpenStreetMap contributors</p>
        </div>
      )}
    </div>
  );
}
