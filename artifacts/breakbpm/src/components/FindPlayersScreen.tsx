/**
 * Find Players — a meetup board. Signed-in users browse posts; paid (pass)
 * users create them. A post pins a spot on a map, a table number, and a
 * date/time. All times are handled as UTC wall-clock values: what the creator
 * types is exactly what every viewer sees — there is NO timezone conversion
 * anywhere in this screen. We read/write the literal Y/M/D H:M via the Date's
 * getUTC accessors and Date.UTC so the displayed value never drifts by locale.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  useListFindPlayerPosts,
  useCreateFindPlayerPost,
  useCancelFindPlayerPost,
  getListFindPlayerPostsQueryKey,
} from "@workspace/api-client-react";
import type { FindPlayerPost } from "@workspace/api-client-react";
import Navbar from "./Navbar";
import { SignedIn, SignedOut } from "../lib/authClient";

interface Props {
  onBack: () => void;
  onAbout: () => void;
  onAccount: () => void;
  onSignIn: () => void;
}

/** 🎱 pin used for every map marker (divIcon avoids bundling marker assets). */
const poolIcon = L.divIcon({
  html: "🎱",
  className: "fpp-pin",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const DEFAULT_CENTER: [number, number] = [39.8283, -98.5795];
const DEFAULT_ZOOM = 4;

const CREATE_REASONS: Record<string, string> = {
  not_signed_in: "You must be signed in to post.",
  not_paid: "A pass is required to create a post.",
  in_past: "Pick a date and time in the future.",
  too_far: "Posts can be at most one year out.",
  duplicate_date: "You already have an active post for that date.",
  limit_reached: "You've reached the limit of 5 active posts.",
};

/** Pad to 2 digits for date/time string building. */
function p2(n: number): string {
  return String(n).padStart(2, "0");
}

/** YYYY-MM-DD for a Date, read in UTC. */
function utcDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

/**
 * Human-readable schedule label built purely from UTC parts — the verbatim
 * wall-clock value the creator entered, shown identically to everyone.
 */
function formatSchedule(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} · ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
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
      icon={poolIcon}
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
  useMemo(() => {
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
  const geo =
    post.latitude != null && post.longitude != null ? `\nGEO:${post.latitude};${post.longitude}` : "";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BreakBPM//Find Players//EN",
    "BEGIN:VEVENT",
    `UID:${post.id}@breakbpm`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:Pool with ${post.displayName}`,
    geo.trim(),
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

export default function FindPlayersScreen({ onBack, onAbout, onAccount, onSignIn }: Props) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [mapView, setMapView] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

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

  const createPost = useCreateFindPlayerPost();
  const cancelPost = useCancelFindPlayerPost();

  // ── Create-form state ──
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [flyKey, setFlyKey] = useState(0);
  const [tableNumber, setTableNumber] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const today = useMemo(() => utcDateStr(new Date()), []);
  const maxDate = useMemo(() => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return utcDateStr(d);
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
    if (scheduledAt.getTime() <= Date.now()) {
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
  const posts = data?.posts ?? [];
  const totalPages = data?.totalPages ?? 0;
  const atLimit = (data?.activePostCount ?? 0) >= (data?.maxActivePosts ?? 5);
  // Cancelled posts return null coordinates, so they're naturally excluded.
  const mappable = (mapList.data?.posts ?? []).filter(
    (p) => p.latitude != null && p.longitude != null,
  );

  return (
    <div className="app-window app-window--page">
      <Navbar onBack={onBack} onAbout={onAbout} onAccount={onAccount} onSignIn={onSignIn} />
      <div className="app-body">
        <div className="panel">
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
              {/* ── Create form (paid only, collapsible) ── */}
              {canCreate ? (
                <div className="fpp-form">
                  <button
                    className="fpp-reveal"
                    type="button"
                    onClick={() => setFormOpen((o) => !o)}
                    aria-expanded={formOpen}
                  >
                    <span>➕ Post a Game</span>
                    <span className="fpp-reveal-caret">{formOpen ? "▲" : "▼"}</span>
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
                  <span className="fpp-coords fpp-coords--caption">
                    {position
                      ? `${position[0].toFixed(4)}, ${position[1].toFixed(4)}`
                      : "Tap the map to drop a pin"}
                  </span>
                  <div className="fpp-form-row">
                    <button className="btn" type="button" onClick={locateMe}>
                      📍 Locate me
                    </button>
                  </div>
                  <label className="fpp-label">
                    Table #
                    <input
                      className="input w-full"
                      type="number"
                      min={0}
                      max={99999}
                      value={tableNumber}
                      onChange={(e) => setTableNumber(e.target.value)}
                      placeholder="e.g. 3"
                    />
                  </label>
                  <div className="fpp-form-row">
                    <label className="fpp-label" style={{ flex: 1 }}>
                      Date
                      <input
                        className="input w-full"
                        type="date"
                        min={today}
                        max={maxDate}
                        value={dateStr}
                        onChange={(e) => setDateStr(e.target.value)}
                      />
                    </label>
                    <label className="fpp-label" style={{ flex: 1 }}>
                      Time (24h)
                      <input
                        className="input w-full"
                        type="time"
                        step={60}
                        value={timeStr}
                        onChange={(e) => setTimeStr(e.target.value)}
                      />
                    </label>
                  </div>
                  {formError && <p className="fpp-error">{formError}</p>}
                  {atLimit && (
                    <p className="fpp-hint">You're at the 5-post limit. Cancel one to free a slot.</p>
                  )}
                  <button
                    className="btn btn-primary btn-big w-full"
                    onClick={submit}
                    disabled={createPost.isPending || atLimit}
                  >
                    {createPost.isPending ? "Posting…" : "Post Game"}
                  </button>
                  </div>
                  )}
                </div>
              ) : (
                <p className="fpp-hint">
                  Browsing as a member. A pass unlocks posting your own games.
                </p>
              )}

              {/* ── List / Map toggle (single button) ── */}
              <div className="fpp-toggle">
                <button
                  className="btn btn-primary fpp-toggle-btn"
                  onClick={() => setMapView((v) => !v)}
                >
                  {mapView ? "📋 List View" : "🗺️ Map View"}
                </button>
              </div>

              {list.isLoading ? (
                <p className="fpp-hint">Loading…</p>
              ) : mapView ? (
                <div className="fpp-map fpp-map--view">
                  <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} style={{ height: "100%", width: "100%" }}>
                    <TileLayer
                      attribution='&copy; OpenStreetMap'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {mappable.map((post) => (
                      <Marker
                        key={post.id}
                        position={[post.latitude as number, post.longitude as number]}
                        icon={poolIcon}
                      >
                        <Popup>
                          <div className="fpp-popup">
                            <div className="fpp-popup-name">{post.displayName}</div>
                            {post.scheduledAt && (
                              <div className="fpp-popup-when">
                                {formatSchedule(new Date(post.scheduledAt))}
                              </div>
                            )}
                            <div className="fpp-popup-coords">
                              📍 {(post.latitude as number).toFixed(4)},{" "}
                              {(post.longitude as number).toFixed(4)}
                            </div>
                            <div className="fpp-popup-actions">
                              <a
                                className="btn"
                                href={`https://www.google.com/maps?q=${post.latitude},${post.longitude}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open in Maps
                              </a>
                              <button className="btn" onClick={() => downloadIcs(post)}>
                                Add to Calendar
                              </button>
                            </div>
                          </div>
                        </Popup>
                      </Marker>
                    ))}
                  </MapContainer>
                </div>
              ) : posts.length === 0 ? (
                <p className="fpp-empty">No games posted yet. Be the first!</p>
              ) : (
                <div className="fpp-list">
                  {posts.map((post) => (
                    <PostCard key={post.id} post={post} onCancel={cancel} pending={cancelPost.isPending} />
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
  onCancel,
  pending,
}: {
  post: FindPlayerPost;
  onCancel: (id: string) => void;
  pending: boolean;
}) {
  const cancelled = post.cancelled;
  return (
    <div className={`fpp-card${cancelled ? " fpp-card--cancelled" : ""}`}>
      <div className="fpp-card-head">
        <span className="fpp-card-name">{post.displayName}</span>
        {cancelled && <span className="fpp-badge">Cancelled</span>}
      </div>
      {!cancelled && post.scheduledAt && (
        <div className="fpp-card-when">{formatSchedule(new Date(post.scheduledAt))}</div>
      )}
      {!cancelled && post.latitude != null && post.longitude != null && (
        <div className="fpp-card-loc">
          📍 {post.latitude.toFixed(4)}, {post.longitude.toFixed(4)}
        </div>
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
              Open in Maps
            </a>
          )}
          <button className="btn" onClick={() => downloadIcs(post)}>
            Add to Calendar
          </button>
          {post.isOwn && (
            <button className="btn btn-danger" disabled={pending} onClick={() => onCancel(post.id)}>
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
