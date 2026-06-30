import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  useListAdminVenues,
  useCreateVenue,
  useUpdateVenue,
  useDeleteVenue,
  useRepairVenueCoordinates,
  getListAdminVenuesQueryKey,
  getListVenuesQueryKey,
} from "@workspace/api-client-react";
import type { Venue, VenueInput } from "@workspace/api-client-react";
import { VENUE_PAYMENT_TYPES, venuePaymentLabel } from "../lib/venuePaymentType";

const PIN = L.divIcon({
  html: '<span class="hud-chip hud-chip-eight" data-number="8"></span>',
  className: "fpp-venue-pin",
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const DEFAULT_CENTER: [number, number] = [20, 0];

/** YYYY-MM-DD (local) from an ISO instant, for <input type="date">. */
function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

/** Lets the admin click the map to (re)place the venue pin. */
function PinPicker({
  position,
  onPick,
}: {
  position: [number, number] | null;
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  if (!position) return null;
  return <Marker position={position} icon={PIN} />;
}

/** Pans/zooms the map to a target whenever `tick` changes (e.g. after a
 * geocode or when an existing venue is opened for editing). */
function Recenter({ at, tick }: { at: [number, number] | null; tick: number }) {
  const map = useMap();
  useEffect(() => {
    if (at) map.setView(at, 15);
    // Intentionally keyed on `tick` only — we don't want to fight the user
    // while they nudge lat/lng by hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  return null;
}

/**
 * Admin-only panel to manage verified venues (the paid, always-on pins on the
 * Find Players map). Add/edit via a pin-drop map + form, toggle active, set a
 * paid-through date, or delete. Parent gates rendering on `isAdmin`; every
 * endpoint also 403s for non-admins. After any mutation both the admin list and
 * the public venue list are invalidated so the map updates immediately.
 */
export default function AdminVenuesPanel() {
  const qc = useQueryClient();
  const list = useListAdminVenues({ query: { queryKey: getListAdminVenuesQueryKey() } });
  const venues = list.data?.venues ?? [];

  const createVenue = useCreateVenue();
  const updateVenue = useUpdateVenue();
  const deleteVenue = useDeleteVenue();
  const repairVenues = useRepairVenueCoordinates();

  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [locality, setLocality] = useState("");
  const [address, setAddress] = useState("");
  const [tableCount, setTableCount] = useState("");
  const [contact, setContact] = useState("");
  const [paymentType, setPaymentType] = useState("");
  const [active, setActive] = useState(true);
  const [paidThrough, setPaidThrough] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geoNote, setGeoNote] = useState("");
  const [repairing, setRepairing] = useState(false);
  const [repairNote, setRepairNote] = useState("");
  // Bumped to ask <Recenter> to pan the map (geocode result / open-for-edit).
  const [recenterTick, setRecenterTick] = useState(0);
  // Monotonic id so a slow geocode can't overwrite coords after the admin has
  // moved on (started editing another venue, reset, or changed the address).
  const geoReqIdRef = useRef(0);

  // Verified-venue list pagination (5 per page).
  const VENUES_PER_PAGE = 5;
  const [venuePage, setVenuePage] = useState(1);
  const venueTotalPages = Math.max(1, Math.ceil(venues.length / VENUES_PER_PAGE));
  // Clamp the page when the list shrinks (e.g. after a delete).
  useEffect(() => {
    if (venuePage > venueTotalPages) setVenuePage(venueTotalPages);
  }, [venuePage, venueTotalPages]);
  const pagedVenues = venues.slice(
    (venuePage - 1) * VENUES_PER_PAGE,
    venuePage * VENUES_PER_PAGE,
  );

  const center = useMemo<[number, number]>(() => {
    const la = Number(lat);
    const lo = Number(lng);
    if (Number.isFinite(la) && Number.isFinite(lo) && lat !== "" && lng !== "") {
      return [la, lo];
    }
    return DEFAULT_CENTER;
  }, [lat, lng]);

  const position = useMemo<[number, number] | null>(() => {
    const la = Number(lat);
    const lo = Number(lng);
    if (lat !== "" && lng !== "" && Number.isFinite(la) && Number.isFinite(lo)) {
      return [la, lo];
    }
    return null;
  }, [lat, lng]);

  const resetForm = () => {
    setEditId(null);
    setName("");
    setLat("");
    setLng("");
    setLocality("");
    setAddress("");
    setTableCount("");
    setContact("");
    setPaymentType("");
    setActive(true);
    setPaidThrough("");
    setError("");
    setGeoNote("");
    geoReqIdRef.current++;
  };

  const startEdit = (v: Venue) => {
    setEditId(v.id);
    setName(v.name);
    setLat(String(v.latitude));
    setLng(String(v.longitude));
    setLocality(v.locality ?? "");
    setAddress(v.address ?? "");
    setTableCount(v.tableCount != null ? String(v.tableCount) : "");
    setContact(v.contact ?? "");
    setPaymentType(v.paymentType ?? "");
    setActive(v.active);
    setPaidThrough(isoToDateInput(v.paidThroughAt));
    setError("");
    setGeoNote("");
    setRecenterTick((t) => t + 1);
    geoReqIdRef.current++;
  };

  const buildInput = (): VenueInput | null => {
    const trimmed = name.trim();
    const la = Number(lat);
    const lo = Number(lng);
    if (!trimmed) {
      setError("Name is required.");
      return null;
    }
    if (!Number.isFinite(la) || la < -90 || la > 90) {
      setError("Latitude must be between -90 and 90.");
      return null;
    }
    if (!Number.isFinite(lo) || lo < -180 || lo > 180) {
      setError("Longitude must be between -180 and 180.");
      return null;
    }
    let tables: number | null = null;
    if (tableCount.trim() !== "") {
      const n = Number(tableCount);
      if (!Number.isInteger(n) || n < 0 || n > 9999) {
        setError("Tables must be a whole number (0–9999).");
        return null;
      }
      tables = n;
    }
    return {
      name: trimmed,
      latitude: la,
      longitude: lo,
      locality: locality.trim() || null,
      address: address.trim() || null,
      tableCount: tables,
      contact: contact.trim() || null,
      paymentType: paymentType
        ? (paymentType as VenueInput["paymentType"])
        : null,
      active,
      paidThroughAt: paidThrough
        ? new Date(`${paidThrough}T00:00:00`).toISOString()
        : null,
    };
  };

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListAdminVenuesQueryKey() });
    void qc.invalidateQueries({ queryKey: getListVenuesQueryKey() });
  };

  const submit = async () => {
    const input = buildInput();
    if (!input) return;
    setBusy(true);
    setError("");
    try {
      const res = editId
        ? await updateVenue.mutateAsync({ id: editId, data: input })
        : await createVenue.mutateAsync({ data: input });
      if (!res.success) {
        setError(res.reason ?? "Couldn't save the venue.");
        return;
      }
      invalidate();
      resetForm();
    } catch {
      setError("Couldn't save the venue. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // Forward-geocode the typed address into accurate coordinates. The address
  // (plus locality for disambiguation) is far more reliable than a hand-typed
  // or roughly clicked lat/lng, which was leaving pins drifting off the real
  // hall. We fill the lat/lng inputs and recenter the map so the admin can
  // confirm the pin before saving. Mirrors the client-side Nominatim usage in
  // FindPlayersScreen; the saved coords are still range-validated server-side.
  const locateFromAddress = async () => {
    const addr = address.trim();
    if (!addr) {
      setGeoNote("Enter an address first, then tap Locate.");
      return;
    }
    const query = [addr, locality.trim()].filter(Boolean).join(", ");
    const reqId = ++geoReqIdRef.current;
    setGeocoding(true);
    setGeoNote("");
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
          query,
        )}&format=json&limit=1`,
        { headers: { "User-Agent": "BreakBPM/1.0" } },
      );
      const data: Array<{ lat?: string; lon?: string }> = await r.json();
      // A newer locate/edit/reset started while we were awaiting — drop this.
      if (geoReqIdRef.current !== reqId) return;
      const hit = data[0];
      const la = hit ? Number(hit.lat) : NaN;
      const lo = hit ? Number(hit.lon) : NaN;
      if (!hit || !Number.isFinite(la) || !Number.isFinite(lo)) {
        setGeoNote("Couldn't find that address — drop the pin manually.");
        return;
      }
      setLat(la.toFixed(6));
      setLng(lo.toFixed(6));
      setRecenterTick((t) => t + 1);
      setGeoNote("📍 Located — check the pin, then save.");
    } catch {
      if (geoReqIdRef.current === reqId) {
        setGeoNote("Geocoding failed — try again or drop the pin manually.");
      }
    } finally {
      if (geoReqIdRef.current === reqId) setGeocoding(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await deleteVenue.mutateAsync({ id });
      if (!res.success) {
        setError(res.reason ?? "Couldn't delete the venue.");
        return;
      }
      if (editId === id) resetForm();
      invalidate();
    } catch {
      setError("Couldn't delete the venue. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // Bulk-repair: re-place every existing pin from its saved address. Fixes pins
  // that were entered with a hand-typed/clicked lat/lng that never matched the
  // real hall. Venues with no address (or one that can't be geocoded) keep their
  // current coordinates and are reported as "couldn't locate".
  const fixAllPins = async () => {
    setRepairNote("");
    setRepairing(true);
    try {
      const res = await repairVenues.mutateAsync();
      if (!res.success) {
        setRepairNote("Couldn't repair pins — try again.");
        return;
      }
      const bits = [`updated ${res.updated}`, `already correct ${res.unchanged}`];
      if (res.failed > 0) bits.push(`couldn't locate ${res.failed}`);
      setRepairNote(`✅ Done — ${bits.join(", ")}.`);
      invalidate();
    } catch {
      setRepairNote("Repair failed — try again.");
    } finally {
      setRepairing(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>
            🎱
          </span>
          Admin — Verified Venues
        </span>
      </div>
      <div
        className="panel-body"
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <p style={{ fontSize: 12, color: "#444", margin: 0 }}>
          Verified halls show as ⭐ 8-ball pins for every signed-in player, above
          the free OpenStreetMap layer. Enter the address and tap “Locate from
          address” for an accurate pin, or click the map to drop it by hand.
        </p>

        <div className="fpp-map fpp-map--form">
          <MapContainer
            center={center}
            zoom={position ? 14 : 2}
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <PinPicker
              position={position}
              onPick={(la, lo) => {
                setLat(la.toFixed(6));
                setLng(lo.toFixed(6));
              }}
            />
            <Recenter at={position} tick={recenterTick} />
          </MapContainer>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="avp-field">
            Name
            <input
              className="input"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              placeholder="Corner Pocket Billiards"
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <label className="avp-field" style={{ flex: 1 }}>
              Latitude
              <input
                className="input"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="49.2827"
              />
            </label>
            <label className="avp-field" style={{ flex: 1 }}>
              Longitude
              <input
                className="input"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="-123.1207"
              />
            </label>
          </div>
          <label className="avp-field">
            Locality (city shown to free users)
            <input
              className="input"
              value={locality}
              maxLength={200}
              onChange={(e) => setLocality(e.target.value)}
              placeholder="Vancouver, Canada"
            />
          </label>
          <label className="avp-field">
            Address (recommended — used to place the pin)
            <input
              className="input"
              value={address}
              maxLength={500}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St"
            />
          </label>
          <div
            style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
          >
            <button
              type="button"
              className="btn"
              onClick={locateFromAddress}
              disabled={geocoding || busy}
            >
              {geocoding ? "Locating…" : "📍 Locate from address"}
            </button>
            {geoNote && (
              <span style={{ fontSize: 11, color: "#444" }}>{geoNote}</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <label className="avp-field" style={{ flex: 1 }}>
              Tables
              <input
                className="input"
                type="number"
                min={0}
                max={9999}
                value={tableCount}
                onChange={(e) => setTableCount(e.target.value)}
                placeholder="12"
              />
            </label>
            <label className="avp-field" style={{ flex: 1 }}>
              Paid through
              <input
                className="input"
                type="date"
                value={paidThrough}
                onChange={(e) => setPaidThrough(e.target.value)}
              />
            </label>
          </div>
          <label className="avp-field">
            Contact (optional)
            <input
              className="input"
              value={contact}
              maxLength={200}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Phone, website, or email"
            />
          </label>
          <label className="avp-field">
            Payment type
            <select
              className="input"
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value)}
            >
              <option value="">— None —</option>
              {VENUE_PAYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {venuePaymentLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <label
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
          >
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active (show on the map)
          </label>
        </div>

        {error && (
          <p style={{ fontSize: 12, color: "#a00", margin: 0 }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : editId ? "Save Changes" : "Add Venue"}
          </button>
          {editId && (
            <button className="btn" onClick={resetForm} disabled={busy}>
              Cancel Edit
            </button>
          )}
        </div>

        <div style={{ borderTop: "1px solid #0002", paddingTop: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 8,
            }}
          >
            <button
              type="button"
              className="btn"
              onClick={fixAllPins}
              disabled={repairing || busy || venues.length === 0}
              title="Re-place every saved pin from its address"
            >
              {repairing ? "Fixing pins…" : "🔧 Fix all pins from addresses"}
            </button>
            {repairNote ? (
              <span style={{ fontSize: 11, color: "#444" }}>{repairNote}</span>
            ) : (
              <span style={{ fontSize: 11, color: "#777" }}>
                Re-places each pin from its saved address (can take a minute).
              </span>
            )}
          </div>
          {list.isLoading ? (
            <p style={{ fontSize: 12, color: "#444", margin: 0 }}>Loading…</p>
          ) : venues.length === 0 ? (
            <p style={{ fontSize: 12, color: "#444", margin: 0 }}>
              No venues yet.
            </p>
          ) : (
            <ul className="avp-list">
              {pagedVenues.map((v) => (
                <li key={v.id} className="avp-row">
                  <div className="avp-row-main">
                    <span className="avp-row-name">
                      {v.active ? "✓" : "•"} {v.name}
                    </span>
                    <span className="avp-row-meta">
                      {v.locality ? `${v.locality} · ` : ""}
                      {v.latitude.toFixed(3)}, {v.longitude.toFixed(3)}
                      {v.paidThroughAt
                        ? ` · paid → ${isoToDateInput(v.paidThroughAt)}`
                        : ""}
                    </span>
                    <a
                      className="avp-row-lb-link"
                      href={`/leaderboard/hall/${v.slug ?? v.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Local Leaderboard ↗
                    </a>
                  </div>
                  <div className="avp-row-actions">
                    <button className="btn" onClick={() => startEdit(v)} disabled={busy}>
                      Edit
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => remove(v.id)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {venueTotalPages > 1 && (
            <div className="fpp-pager">
              <button
                className="btn"
                disabled={venuePage <= 1}
                onClick={() => setVenuePage((p) => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <span className="fpp-page-label">
                Page {venuePage} / {venueTotalPages}
              </span>
              <button
                className="btn"
                disabled={venuePage >= venueTotalPages}
                onClick={() => setVenuePage((p) => Math.min(venueTotalPages, p + 1))}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
