/**
 * Find Players — a meetup board. Signed-in users browse posts; paid (pass)
 * users create them. A post pins a spot on a map, a table number, and a
 * date/time. All times are handled as UTC wall-clock values: what the creator
 * types is exactly what every viewer sees — there is NO timezone conversion
 * anywhere in this screen. We read/write the literal Y/M/D H:M via the Date's
 * getUTC accessors and Date.UTC so the displayed value never drifts by locale.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  useListFindPlayerPosts,
  useCreateFindPlayerPost,
  useCancelFindPlayerPost,
  useListVenues,
  getListVenuesQueryKey,
  getListFindPlayerPostsQueryKey,
} from "@workspace/api-client-react";
import type { FindPlayerPost, Venue } from "@workspace/api-client-react";
import Navbar from "./Navbar";
import { SignedIn, SignedOut } from "../lib/authClient";
import { SOLIDS } from "../lib/gameLogic";
import { haversineKm } from "../lib/geo";
import { fetchOsmVenues, MIN_VENUE_ZOOM, type OsmVenue } from "../lib/osmVenues";
import NearestHallCompass from "./NearestHallCompass";

/** Pool-ball colors, mirrored from the game HUD, for the rank chips. */
const BALL_COLORS: Record<number, string> = {
  1: "#FDD307", 2: "#1F4E9E", 3: "#C3342B", 4: "#5B247A",
  5: "#F27C1D", 6: "#276B40", 7: "#6B1F2A", 8: "#000000",
  9: "#FDD307", 10: "#1F4E9E",
};

interface Props {
  onBack: () => void;
  onAbout: () => void;
  onAccount: () => void;
  onSignIn: () => void;
  onPasses: () => void;
}

/** Cue-ball pin for MEETUP posts (divIcon avoids bundling marker assets). */
const cueBallIcon = L.divIcon({
  html: '<span class="cue-ball-icon" style="font-size:26px"></span>',
  className: "fpp-pin",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

/** Real 8-ball pin for an OSM pool-hall VENUE. */
const venueIcon = L.divIcon({
  html: '<span class="hud-chip hud-chip-eight" data-number="8"></span>',
  className: "fpp-venue-pin",
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

/** 8-ball pin with a Verified badge for an admin-authorized VENUE. */
const verifiedVenueIcon = L.divIcon({
  html:
    '<span class="hud-chip hud-chip-eight" data-number="8"></span>' +
    '<span class="fpp-verified-badge">✓</span>',
  className: "fpp-venue-pin fpp-venue-pin--verified",
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

/** OSM venue layer loading/feedback state, surfaced over the map. */
type OsmStatus = "idle" | "loading" | "ok" | "empty" | "zoom-in" | "error";

/** Map an OSM layer status to a user-facing overlay message (null = silent). */
function osmStatusMessage(s: OsmStatus): string | null {
  switch (s) {
    case "loading":
      return "Loading pool halls…";
    case "zoom-in":
      return "Zoom in to see pool halls";
    case "error":
      return "Couldn't load pool halls";
    default:
      return null;
  }
}

const DEFAULT_CENTER: [number, number] = [20, 0];
const DEFAULT_ZOOM = 2;

/** "Near Me" radius in kilometres. */
const NEAR_RADIUS_KM = 25;

/** Trims a stored "City, Country" label down to just the city for display. */
function cityOf(label: string): string {
  return label.split(",")[0].trim();
}

// haversineKm is imported from ../lib/geo (shared with the nearest-hall compass).

/** Fits the map view to all visible pins whenever the set of pins changes. */
function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const key = positions.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 13);
      return;
    }
    map.fitBounds(L.latLngBounds(positions), { padding: [40, 40], maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

/**
 * Live OSM pool-hall layer. Tracks the map viewport and (debounced) fetches
 * billiards venues from Overpass for the visible bounds, rendering an 8-ball
 * pin per hall. Refuses to query below {@link MIN_VENUE_ZOOM}. De-dupes any
 * OSM hall that sits on top of an admin-verified one so they never double-pin.
 * `onStatus` lets the parent surface a "zoom in / loading / error" overlay.
 */
function OsmVenueLayer({
  verifiedVenues,
  onStatus,
}: {
  verifiedVenues: Venue[];
  onStatus: (s: OsmStatus) => void;
}) {
  const map = useMap();
  const [osm, setOsm] = useState<OsmVenue[]>([]);
  const timerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(() => {
    if (map.getZoom() < MIN_VENUE_ZOOM) {
      setOsm([]);
      onStatus("zoom-in");
      return;
    }
    const b = map.getBounds();
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    onStatus("loading");
    void fetchOsmVenues(
      { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
      { signal: ac.signal },
    ).then((res) => {
      if (ac.signal.aborted) return;
      if (res.status === "ok") {
        setOsm(res.venues);
        onStatus(res.venues.length ? "ok" : "empty");
      } else if (res.status === "too-broad") {
        setOsm([]);
        onStatus("zoom-in");
      } else {
        onStatus("error"); // keep the last good venues on the map
      }
    });
  }, [map, onStatus]);

  const schedule = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(run, 500);
  }, [run]);

  useMapEvents({ moveend: schedule, zoomend: schedule });

  useEffect(() => {
    run();
    return () => {
      abortRef.current?.abort();
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [run]);

  // Hide an OSM venue that sits within ~50m of a verified one (same hall).
  const deduped = osm.filter(
    (o) =>
      !verifiedVenues.some(
        (v) => haversineKm([o.latitude, o.longitude], [v.latitude, v.longitude]) < 0.05,
      ),
  );

  return (
    <>
      {deduped.map((v) => (
        <Marker
          key={v.id}
          position={[v.latitude, v.longitude]}
          icon={venueIcon}
          zIndexOffset={100}
        >
          <Popup>
            <div className="fpp-popup">
              <div className="fpp-popup-name">🎱 {v.name}</div>
              {v.tableCount != null && (
                <div className="fpp-popup-when">{v.tableCount} tables</div>
              )}
              <div className="fpp-popup-coords">Pool hall (OpenStreetMap)</div>
              <div className="fpp-popup-actions">
                <a
                  className="btn"
                  href={`https://www.google.com/maps?q=${v.latitude},${v.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  🗺️ Maps
                </a>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}

const CREATE_REASONS: Record<string, string> = {
  not_signed_in: "You must be signed in to post.",
  not_paid: "A pass is required to create a post.",
  in_past: "Pick today or a later date.",
  too_far: "Posts can be at most one year out.",
  duplicate_date: "You already have an active post for that date.",
  limit_reached: "You've reached the limit of 5 active posts.",
};

/** Pad to 2 digits for date/time string building. */
function p2(n: number): string {
  return String(n).padStart(2, "0");
}

/** YYYY-MM-DD for a Date, read in the viewer's local timezone. */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/**
 * Human-readable schedule label built purely from UTC parts — the verbatim
 * wall-clock value the creator entered, shown identically to everyone.
 */
function formatSchedule(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} @ ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** Click-to-place + draggable marker for the create form. */
function LocationPicker({
  position,
  setPosition,
}: {
  position: [number, number] | null;
  setPosition: (p: [number, number]) => void;
}) {
  useMapEvents({
    click(e) {
      setPosition([e.latlng.lat, e.latlng.lng]);
    },
  });
  if (!position) return null;
  return (
    <Marker
      position={position}
      icon={cueBallIcon}
      draggable
      eventHandlers={{
        dragend(e) {
          const ll = (e.target as L.Marker).getLatLng();
          setPosition([ll.lat, ll.lng]);
        },
      }}
    />
  );
}

/** Imperatively recenters the map when "Locate me" bumps `flyKey`. */
function FlyTo({ position, flyKey }: { position: [number, number] | null; flyKey: number }) {
  const map = useMap();
  useEffect(() => {
    if (flyKey > 0 && position) map.flyTo(position, 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyKey]);
  return null;
}

/** Builds and triggers download of a single-event .ics calendar file. */
function downloadIcs(post: FindPlayerPost) {
  if (!post.scheduledAt) return;
  const start = new Date(post.scheduledAt);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const stamp = (d: Date) =>
    `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}00Z`;
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const geo =
    post.latitude != null && post.longitude != null ? `GEO:${post.latitude};${post.longitude}` : "";
  const locationText = [
    post.locationLabel,
    post.tableNumber != null ? `Table ${post.tableNumber}` : null,
  ]
    .filter(Boolean)
    .join(" — ");
  const location = locationText ? `LOCATION:${esc(locationText)}` : "";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BreakBPM//Find Players//EN",
    "BEGIN:VEVENT",
    `UID:${post.id}@breakbpm`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:Pool with ${esc(post.displayName)}`,
    location,
    geo,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `breakbpm-${post.id}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FindPlayersScreen({
  onBack,
  onAbout,
  onAccount,
  onSignIn,
  onPasses,
}: Props) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [mapView, setMapView] = useState(false);
  const [todayOnly, setTodayOnly] = useState(false);
  const [next30Only, setNext30Only] = useState(false);
  const [nearMeOnly, setNearMeOnly] = useState(false);
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [compassOpen, setCompassOpen] = useState(false);
  const [osmStatus, setOsmStatus] = useState<OsmStatus>("idle");
  const [ackPublic, setAckPublic] = useState(false);

  const list = useListFindPlayerPosts({ page });
  const data = list.data;

  // Map view must plot EVERY active post globally, not just the current list
  // page — so it uses a separate unpaginated query, fetched only when shown.
  const mapList = useListFindPlayerPosts(
    { all: true },
    {
      query: {
        enabled: mapView,
        queryKey: getListFindPlayerPostsQueryKey({ all: true }),
      },
    },
  );

  // Verified venues (admin listings). Fetched whenever a venue surface is
  // visible — the map layer or the nearest-hall compass.
  const venuesQuery = useListVenues({
    query: {
      enabled: mapView || compassOpen,
      queryKey: getListVenuesQueryKey(),
    },
  });
  const verifiedVenues = venuesQuery.data?.venues ?? [];

  const createPost = useCreateFindPlayerPost();
  const cancelPost = useCancelFindPlayerPost();

  // ── Create-form state ──
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [flyKey, setFlyKey] = useState(0);
  const [locationPreview, setLocationPreview] = useState<string | null>(null);
  const [tableNumber, setTableNumber] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Client-side reverse-geocode preview — fires when the user drops/moves a
  // pin in the form. Uses the same Nominatim endpoint the server calls at
  // create time, so the preview matches what will be stored.
  useEffect(() => {
    if (!position) { setLocationPreview(null); return; }
    let cancelled = false;
    const [lat, lon] = position;
    fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { "User-Agent": "BreakBPM/1.0" } },
    )
      .then((r) => r.json())
      .then((data: { address?: { city?: string; town?: string; village?: string; county?: string; country?: string } }) => {
        if (cancelled) return;
        const addr = data.address;
        const locality = addr?.city ?? addr?.town ?? addr?.village ?? addr?.county ?? null;
        setLocationPreview(locality);
      })
      .catch(() => { if (!cancelled) setLocationPreview(null); });
    return () => { cancelled = true; };
  }, [position]);

  const today = useMemo(() => localDateStr(new Date()), []);
  const maxDate = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return localDateStr(d);
  }, []);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListFindPlayerPostsQueryKey() });

  const locateMe = () => {
    if (!navigator.geolocation) {
      setFormError("Geolocation is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition([pos.coords.latitude, pos.coords.longitude]);
        setFlyKey((k) => k + 1);
      },
      () => setFormError("Couldn't get your location."),
    );
  };

  const toggleNearMe = () => {
    if (nearMeOnly) {
      setNearMeOnly(false);
      return;
    }
    // Enabling Near Me is a view swap — leave the map/compass views.
    setMapView(false);
    setCompassOpen(false);
    if (userCoords) {
      setNearMeOnly(true);
      return;
    }
    if (!navigator.geolocation) {
      setFormError("Geolocation is not available in this browser.");
      return;
    }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords([pos.coords.latitude, pos.coords.longitude]);
        setNearMeOnly(true);
        setGeoBusy(false);
      },
      () => {
        setFormError("Couldn't get your location.");
        setGeoBusy(false);
      },
    );
  };

  const submit = async () => {
    setFormError(null);
    if (!position) {
      setFormError("Drop a pin on the map first.");
      return;
    }
    const table = Number(tableNumber);
    if (!Number.isInteger(table) || table < 0) {
      setFormError("Enter a valid table number.");
      return;
    }
    if (!dateStr || !timeStr) {
      setFormError("Pick a date and time.");
      return;
    }
    // Treat the entered value as a literal UTC wall-clock instant.
    const scheduledAt = new Date(`${dateStr}T${timeStr}:00.000Z`);
    if (Number.isNaN(scheduledAt.getTime())) {
      setFormError("Invalid date or time.");
      return;
    }
    // Reject only past calendar dates in the poster's LOCAL frame (what the
    // date picker shows); any time on today or later is allowed. The typed
    // date is the canonical label, so a plain string compare is correct.
    if (dateStr < localDateStr(new Date())) {
      setFormError(CREATE_REASONS.in_past);
      return;
    }
    try {
      const res = await createPost.mutateAsync({
        data: {
          latitude: position[0],
          longitude: position[1],
          tableNumber: table,
          scheduledAt: scheduledAt.toISOString(),
        },
      });
      if (!res.success) {
        setFormError(CREATE_REASONS[res.reason ?? ""] ?? "Couldn't create the post.");
        return;
      }
      setTableNumber("");
      setDateStr("");
      setTimeStr("");
      setAckPublic(false);
      setFormOpen(false);
      setPage(1);
      invalidate();
    } catch {
      setFormError("Couldn't create the post. Try again.");
    }
  };

  const cancel = async (id: string) => {
    try {
      await cancelPost.mutateAsync({ data: { id } });
      invalidate();
    } catch {
      /* surfaced by refetch */
    }
  };

  const canCreate = data?.canCreate ?? false;
  const preciseLocationsVisible = data?.preciseLocationsVisible ?? false;
  const todayStr = useMemo(() => localDateStr(new Date()), []);
  const next30Str = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return localDateStr(d);
  }, []);
  const filterPosts = <
    T extends { scheduledAt?: string | null; latitude?: number | null; longitude?: number | null },
  >(
    arr: T[],
  ): T[] => {
    let out = arr;
    if (todayOnly) out = out.filter((p) => p.scheduledAt != null && p.scheduledAt.slice(0, 10) === todayStr);
    else if (next30Only) out = out.filter((p) => p.scheduledAt != null && p.scheduledAt.slice(0, 10) <= next30Str);
    if (nearMeOnly && userCoords) {
      out = out.filter(
        (p) =>
          p.latitude != null &&
          p.longitude != null &&
          haversineKm(userCoords, [p.latitude, p.longitude]) <= NEAR_RADIUS_KM,
      );
    }
    return out;
  };
  const allPosts = data?.posts ?? [];
  const posts = filterPosts(allPosts);
  const totalPages = data?.totalPages ?? 0;
  const atLimit = (data?.activePostCount ?? 0) >= (data?.maxActivePosts ?? 5);
  // Cancelled posts return null coordinates, so they're naturally excluded.
  const allMappable = (mapList.data?.posts ?? []).filter(
    (p) => p.latitude != null && p.longitude != null,
  );
  const mappable = filterPosts(allMappable);

  return (
    <div className="app-window app-window--page">
      <Navbar onBack={onBack} onAbout={onAbout} onAccount={onAccount} onSignIn={onSignIn} />
      <div className="app-body">
        <SignedIn>
          {/* ── Create form (paid only, collapsible) ── */}
          {canCreate ? (
            <div className="panel fpp-form">
              <button
                type="button"
                className="panel-header"
                onClick={() => setFormOpen((o) => !o)}
                aria-expanded={formOpen}
                style={{ width: "100%", border: "none", cursor: "pointer", font: "inherit", textAlign: "left" }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                  className="text-[13px] font-semibold text-[#ffffff]">
                  POST A MEETUP
                </span>
                <span aria-hidden="true" className="text-[#000000]">{formOpen ? "▼" : "▶"}</span>
              </button>
              {formOpen && (
              <div className="fpp-form-fields">
              <div className="fpp-map fpp-map--form">
                <MapContainer center={position ?? DEFAULT_CENTER} zoom={position ? 15 : DEFAULT_ZOOM} style={{ height: "100%", width: "100%" }}>
                  <TileLayer
                    attribution='&copy; OpenStreetMap'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <LocationPicker position={position} setPosition={setPosition} />
                  <FlyTo position={position} flyKey={flyKey} />
                </MapContainer>
              </div>
              <div className="fpp-form-row fpp-form-row--compact">
                <label className="fpp-label fpp-label--row">Location</label>
                <button className="btn fpp-locate-btn" type="button" onClick={locateMe}>
                  📍 Locate me
                </button>
                <span className="fpp-row-hint fpp-row-hint--coords text-[#777777]">
                  {locationPreview ?? (position ? "Locating…" : "Or tap the map")}
                </span>
              </div>
              <p className="fpp-disclose">
                ⚠️ Your exact pin is shared publicly with pass holders. Pick a
                public spot — a pool hall, not your home.
              </p>
              <div className="fpp-form-row fpp-form-row--compact">
                <label className="fpp-label fpp-label--row">
                  Table #
                </label>
                <input
                  className="input fpp-table-input"
                  type="number"
                  min={0}
                  max={99999}
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  placeholder="e.g. 3"
                />
                <span className="fpp-row-hint">Which table you'll be on</span>
              </div>
              <div className="fpp-form-row fpp-form-row--compact">
                <label className="fpp-label fpp-label--row">Date</label>
                <input
                  className="input fpp-date-input"
                  type="date"
                  min={today}
                  max={maxDate}
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                />
                <span className="fpp-row-hint">Up to 1 year out</span>
              </div>
              <div className="fpp-form-row fpp-form-row--compact">
                <label className="fpp-label fpp-label--row">Time</label>
                <input
                  className="input fpp-time-input"
                  type="time"
                  step={60}
                  value={timeStr}
                  onChange={(e) => setTimeStr(e.target.value)}
                />
                <span className="fpp-row-hint">24-hour clock</span>
              </div>
              {formError && <p className="fpp-error">{formError}</p>}
              {atLimit && (
                <p className="fpp-hint">You're at the 5-post limit. Cancel one to free a slot.</p>
              )}
              <label className="fpp-ack">
                <input
                  type="checkbox"
                  checked={ackPublic}
                  onChange={(e) => setAckPublic(e.target.checked)}
                />
                I understand my pin is public to pass holders.
              </label>
              <button
                className="btn btn-primary btn-big w-full"
                onClick={submit}
                disabled={createPost.isPending || atLimit || !ackPublic}
              >
                {createPost.isPending ? "Posting…" : "Post Meetup"}
              </button>
              </div>
              )}
            </div>
          ) : (
            <p className="fpp-hint">
              Browsing as a member. A pass unlocks posting your own games.
            </p>
          )}
        </SignedIn>

        <div className="panel panel--wood">
          <div className="panel-header">FIND PLAYERS</div>
          <div className="panel-body">
            <SignedOut>
              <p className="fpp-empty">
                Sign in to see who's looking for a game near you.
              </p>
              <button className="btn btn-primary" onClick={onSignIn}>
                Sign In
              </button>
            </SignedOut>

            <SignedIn>

              {/* ── List / Map toggle (single button) ──
                  Hidden while the Post-a-Meetup form is open. */}
              {!formOpen && (
              <div className="fpp-toggle">
                <button
                  className="btn btn-primary fpp-toggle-btn"
                  onClick={() => { setMapView((v) => { if (!v) invalidate(); return !v; }); setTodayOnly(false); setNext30Only(false); setNearMeOnly(false); setCompassOpen(false); }}
                >
                  {mapView ? "📋 List View" : "🗺️ Map View"}
                </button>
                <button
                  className={`btn fpp-toggle-btn${next30Only ? " btn-primary" : ""}`}
                  onClick={() => { setNext30Only((v) => !v); setTodayOnly(false); }}
                >
                  🗓️ 30 Days
                </button>
                <button
                  className={`btn fpp-toggle-btn${todayOnly ? " btn-primary" : ""}`}
                  onClick={() => { setTodayOnly((v) => !v); setNext30Only(false); }}
                >
                  📅 Today
                </button>
                <button
                  className={`btn fpp-toggle-btn${compassOpen ? " btn-primary" : ""}`}
                  onClick={() => { setCompassOpen((v) => !v); setMapView(false); setNearMeOnly(false); }}
                >
                  🧭 Nearest Hall
                </button>
                <button
                  className={`btn fpp-toggle-btn${nearMeOnly ? " btn-primary" : ""}`}
                  onClick={toggleNearMe}
                  disabled={geoBusy}
                >
                  {geoBusy ? "📍 Locating…" : "📍 Near Me"}
                </button>
              </div>
              )}

              {!preciseLocationsVisible && !compassOpen && !mapView && (
                <p className="fpp-hint fpp-coarse-note">
                  📍 Showing approximate areas only.{" "}
                  <button className="fpp-link" onClick={onPasses}>
                    Get a pass
                  </button>{" "}
                  to see exact meetup spots.
                </p>
              )}

              {compassOpen ? (
                <NearestHallCompass
                  verifiedVenues={verifiedVenues}
                  onExit={() => setCompassOpen(false)}
                />
              ) : list.isLoading ? (
                <p className="fpp-hint">Loading…</p>
              ) : mapView ? (
                <>
                <div className="fpp-map fpp-map--view">
                  <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} style={{ height: "100%", width: "100%" }}>
                    <TileLayer
                      attribution='&copy; OpenStreetMap'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <FitBounds
                      positions={mappable.map((p) => [p.latitude as number, p.longitude as number])}
                    />
                    {verifiedVenues.map((v) => (
                      <Marker
                        key={v.id}
                        position={[v.latitude, v.longitude]}
                        icon={verifiedVenueIcon}
                        zIndexOffset={1000}
                      >
                        <Popup>
                          <div className="fpp-popup">
                            <div className="fpp-popup-name">🎱 {v.name}</div>
                            {v.locality && (
                              <div className="fpp-popup-coords">📍 {v.locality}</div>
                            )}
                            {v.tableCount != null && (
                              <div className="fpp-popup-when">{v.tableCount} tables</div>
                            )}
                            <div className="fpp-popup-coords fpp-popup-verified">
                              ✓ Verified hall
                            </div>
                            <div className="fpp-popup-actions">
                              <a
                                className="btn"
                                href={`https://www.google.com/maps?q=${v.latitude},${v.longitude}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                🗺️ Maps
                              </a>
                            </div>
                          </div>
                        </Popup>
                      </Marker>
                    ))}
                    <OsmVenueLayer verifiedVenues={verifiedVenues} onStatus={setOsmStatus} />
                    {mappable.map((post) => (
                      <Marker
                        key={post.id}
                        position={[post.latitude as number, post.longitude as number]}
                        icon={cueBallIcon}
                      >
                        <Popup>
                          <div className="fpp-popup">
                            <div className="fpp-popup-name">{post.displayName}</div>
                            {post.scheduledAt && (
                              <div className="fpp-popup-when">
                                {formatSchedule(new Date(post.scheduledAt))}
                              </div>
                            )}
                            {post.locationLabel && (
                              <div className="fpp-popup-coords">
                                📍 {cityOf(post.locationLabel)}
                              </div>
                            )}
                            <div className="fpp-popup-actions">
                              <a
                                className="btn"
                                href={`https://www.google.com/maps?q=${post.latitude},${post.longitude}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                🗺️ Maps
                              </a>
                              <button className="btn" onClick={() => downloadIcs(post)}>
                                📅 Calendar
                              </button>
                            </div>
                          </div>
                        </Popup>
                      </Marker>
                    ))}
                  </MapContainer>
                  {osmStatusMessage(osmStatus) && (
                    <div className="fpp-map-status">{osmStatusMessage(osmStatus)}</div>
                  )}
                </div>
                <p className="fpp-attribution">
                  <span className="fpp-attribution-key">
                    <span className="cue-ball-icon" /> meetup ·{" "}
                    <span className="hud-chip hud-chip-eight" data-number="8" /> pool hall
                  </span>
                  Venue data © OpenStreetMap contributors
                </p>
                </>
              ) : posts.length === 0 ? (
                <p className="fpp-empty">
                  {nearMeOnly
                    ? `No games within ${NEAR_RADIUS_KM}km of you.`
                    : todayOnly
                      ? "Nothing today — try 30 Days."
                      : next30Only
                        ? "Nothing in the next 30 days."
                        : "No games posted yet. Be the first!"}
                </p>
              ) : (
                <div className="fpp-list">
                  {posts.map((post, i) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      rank={i + 1}
                      onCancel={cancel}
                      pending={cancelPost.isPending}
                      preciseLocationsVisible={preciseLocationsVisible}
                      onUpsell={onPasses}
                    />
                  ))}
                </div>
              )}

              {/* ── Pagination ── */}
              {!mapView && totalPages > 1 && (
                <div className="fpp-pager">
                  <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    ← Prev
                  </button>
                  <span className="fpp-page-label">
                    Page {data?.page ?? page} / {totalPages}
                  </span>
                  <button className="btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next →
                  </button>
                </div>
              )}
            </SignedIn>
          </div>
        </div>
      </div>
    </div>
  );
}

function PostCard({
  post,
  rank,
  onCancel,
  pending,
  preciseLocationsVisible,
  onUpsell,
}: {
  post: FindPlayerPost;
  rank: number;
  onCancel: (id: string) => void;
  pending: boolean;
  preciseLocationsVisible: boolean;
  onUpsell: () => void;
}) {
  const cancelled = post.cancelled;
  const chipClass =
    rank === 8 ? "hud-chip-eight" : SOLIDS.includes(rank) ? "hud-chip-solid" : "hud-chip-stripe";
  return (
    <div className={`fpp-card${cancelled ? " fpp-card--cancelled" : ""}`}>
      <div className="fpp-card-head">
        <span className="fpp-card-name">{post.displayName}</span>
        <span className="fpp-card-rank">
          {cancelled && <span className="fpp-badge">Cancelled</span>}
          {cancelled ? (
            <span className="cue-ball-icon cue-ball-icon--chip" role="img" aria-label="Open table" />
          ) : (
            rank <= 10 && (
              <span
                className={`hud-chip ${chipClass}`}
                data-number={rank}
                style={{ "--chip-color": BALL_COLORS[rank] } as React.CSSProperties}
                aria-label={`Sort order ${rank}`}
              />
            )
          )}
        </span>
      </div>
      {!cancelled && post.scheduledAt && (
        <div className="fpp-card-when">{formatSchedule(new Date(post.scheduledAt))}</div>
      )}
      {!cancelled && post.locationLabel && (
        <div className="fpp-card-loc">📍 {post.locationLabel}</div>
      )}
      {!cancelled && (
        <div className="fpp-card-actions">
          {post.latitude != null && post.longitude != null && (
            <a
              className="btn"
              href={`https://www.google.com/maps?q=${post.latitude},${post.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              🗺️ Open in Maps
            </a>
          )}
          {post.latitude == null && !preciseLocationsVisible && !post.isOwn && (
            <button className="btn fpp-upsell-btn" onClick={onUpsell}>
              🔒 Unlock exact location
            </button>
          )}
          <button className="btn" onClick={() => downloadIcs(post)}>
            📅 Add to Calendar
          </button>
          {post.isOwn && (
            <button
              className="btn btn-danger fpp-cancel-btn"
              disabled={pending}
              onClick={() => onCancel(post.id)}
            >
              ❌ Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
