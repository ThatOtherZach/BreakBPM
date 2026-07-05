import { Fragment, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import Navbar from "./Navbar";
import LegalDisclosure from "./LegalDisclosure";
import { venueWebsiteUrl } from "./FindPlayersScreen";
import { venuePaymentBadge } from "../lib/venuePaymentType";
import { useListVenues, getListVenuesQueryKey } from "@workspace/api-client-react";
import { usePageMeta, PAGE_META } from "../lib/pageMeta";
import {
  FOR_VENUES_H1,
  FOR_VENUES_TAGLINE,
  FOR_VENUES_INTRO,
  FOR_VENUES_SHOWCASE,
  FOR_VENUES_ASK_TITLE,
  FOR_VENUES_ASK_BODY,
  FOR_VENUES_HOWTO_TITLE,
  FOR_VENUES_HOWTO_BODY,
  FOR_VENUES_CTA_LABEL,
  FOR_VENUES_MAILTO,
  FOR_VENUES_FAQ,
} from "../lib/landingContent";

/** Star pin for a verified hall on the "all our pool halls" map. */
const starIcon = L.divIcon({
  html: '<span style="font-size:20px;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.6))">🎱</span>',
  className: "fpp-venue-pin",
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

/** Fits the map view to every verified hall once they load. */
function FitToVenues({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const key = positions.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 12);
      return;
    }
    map.fitBounds(L.latLngBounds(positions), { padding: [30, 30], maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

/** Live map of every Verified Hall, so a prospective venue owner can see the
 *  network they'd be joining (and that their own hall would show up starred). */
function AllHallsMap() {
  const { data, isLoading } = useListVenues(
    { all: true },
    { query: { queryKey: getListVenuesQueryKey({ all: true }) } },
  );
  const venues = data?.venues ?? [];
  const positions: [number, number][] = venues.map((v) => [v.latitude, v.longitude]);

  if (isLoading) return null;
  if (venues.length === 0) return null;

  return (
    <div className="lp-map-wrap">
      <div className="fpp-map lp-map">
        <MapContainer center={[20, 0]} zoom={2} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitToVenues positions={positions} />
          {venues.map((v) => (
            <Marker key={v.id} position={[v.latitude, v.longitude]} icon={starIcon}>
              <Popup>
                <div className="fpp-popup">
                  <div className="fpp-popup-name">🎱 {v.name}</div>
                  {v.locality && <div className="fpp-popup-coords">🏙️ {v.locality}</div>}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <p className="lp-map-caption">
        {venues.length} Verified Hall{venues.length === 1 ? "" : "s"} on the map — yours could be
        next. <span className="fpp-attribution">Map data © OpenStreetMap contributors</span>
      </p>
    </div>
  );
}

/** Shows a real, live verified-hall card so a venue owner sees exactly what
 *  their listing looks like. Falls back to a static image when no hall exists. */
function LatestHallWidget({
  fallbackImg,
  fallbackAlt,
}: {
  fallbackImg?: string;
  fallbackAlt?: string;
}) {
  const [, setLocation] = useLocation();
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkCopyFailed, setLinkCopyFailed] = useState(false);
  const { data } = useListVenues(
    { page: 1, limit: 1 },
    { query: { queryKey: getListVenuesQueryKey({ page: 1, limit: 1 }) } },
  );
  const venue = data?.venues?.[0];

  if (!venue) {
    if (fallbackImg)
      return (
        <img
          src={fallbackImg}
          alt={fallbackAlt}
          className="lp-sneak-img"
          loading="lazy"
        />
      );
    return null;
  }

  const hallUrl = `${globalThis.location?.origin ?? ""}/leaderboard/hall/${venue.slug ?? venue.id}`;
  const websiteUrl = venueWebsiteUrl(venue.contact);
  const pay = venuePaymentBadge(venue.paymentType);

  return (
    <div className="fpp-list fpp-venue-list">
      <div className="fpp-card fpp-card--venue">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="fpp-card-name">
              <span className="cue-ball-icon" aria-hidden="true" style={{ fontSize: "18.4px" }} /> {venue.name}
            </div>
            {venue.locality && (
              <div className="fpp-card-loc">
                🏙️{" "}
                <span
                  style={{ cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 2 }}
                  title={`View ${venue.locality} city leaderboard`}
                  onClick={() => setLocation(`/leaderboard/city/${encodeURIComponent(venue.locality!)}`)}
                >
                  {venue.locality}
                </span>
              </div>
            )}
            {venue.tableCount != null && (
              <div className="fpp-card-loc">🎱 {venue.tableCount} Tables</div>
            )}
            {pay && (
              <div className="fpp-card-pay">
                <span className="fpp-pay-badge">{pay.icon} {pay.label}</span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span
              style={{ background: "#fff", padding: 5, borderRadius: 4, lineHeight: 0 }}
              title="Scan to open this hall's leaderboard"
            >
              <QRCodeSVG value={hallUrl} size={72} level="M" />
            </span>
            <button
              type="button"
              className="btn"
              style={{ fontSize: 11, padding: "1px 8px", width: "100%" }}
              onClick={() => {
                navigator.clipboard.writeText(hallUrl).then(
                  () => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); },
                  () => { setLinkCopyFailed(true); setTimeout(() => setLinkCopyFailed(false), 2000); },
                );
              }}
            >
              {linkCopied ? "✓ Copied" : linkCopyFailed ? "⚠ Failed" : "📋 Copy"}
            </button>
          </div>
        </div>
        <div className="fpp-card-actions">
          <button
            type="button"
            className="btn"
            onClick={() => setLocation(`/leaderboard/hall/${venue.slug ?? venue.id}`)}
          >🏆 Local Leaderboard</button>
          <a
            className="btn"
            href={`https://www.google.com/maps?q=${venue.latitude},${venue.longitude}`}
            target="_blank"
            rel="noreferrer"
          >
            🗺️ Open in Maps
          </a>
          {websiteUrl && (
            <a className="btn" href={websiteUrl} target="_blank" rel="noopener">
              🌐 Website
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  onHome: () => void;
  onManual: () => void;
  onAccount: () => void;
  onStats: () => void;
  onFindPlayers: () => void;
  onSignIn: () => void;
  onPasses: () => void;
}

/**
 * SEO/LLM-crawlable, venue-owner-facing marketing page at `/for-venues`. The
 * build-time prerenderer (vite.config.ts) emits a static, keyword-rich HTML
 * version of this same copy (sourced from `landingContent.ts`) plus Service +
 * FAQPage JSON-LD, so crawlers without JS still get the full pitch. Once the
 * bundle loads, this interactive version takes over and embeds a live verified
 * hall card so an owner sees exactly what their listing looks like.
 */
export default function ForVenuesScreen({
  onHome,
  onManual,
  onAccount,
  onStats,
  onFindPlayers,
  onSignIn,
  onPasses,
}: Props) {
  usePageMeta(PAGE_META.forVenues);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="app-window app-window--page">
      <Navbar
        onBack={onHome}
        onManual={onManual}
        onAccount={onAccount}
        onStats={onStats}
        onFindPlayers={onFindPlayers}
        onSignIn={onSignIn}
      />
      <div className="app-body">
        <div className="panel">
          <div className="panel-header">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden="true">🎱</span>BreakBPM for Venues
            </span>
          </div>
          <div className="panel-body lp-body">

            {/* ── The pitch ── */}
            <h1 className="lp-h1 text-center">{FOR_VENUES_H1}</h1>
            <p className="lp-lore">{FOR_VENUES_TAGLINE}</p>
            <p className="lp-intro">{FOR_VENUES_INTRO}</p>

            <a className="btn btn-primary btn-big w-full" href={FOR_VENUES_MAILTO}>
              ✉ {FOR_VENUES_CTA_LABEL}
            </a>

            <img
              src="/breakbpm-poster.png"
              alt="The BreakBPM poster you'd display by your pool table"
              className="lp-img"
            />

            {/* ── What the venue gets ── */}
            {FOR_VENUES_SHOWCASE.map((item) => (
              <Fragment key={item.title}>
                <section className="lp-feature">
                  <h2 className="lp-h2">{item.title}</h2>
                  <p>{item.body}</p>
                  {item.liveHall ? (
                    <LatestHallWidget
                      fallbackImg={item.img}
                      fallbackAlt={item.imgAlt}
                    />
                  ) : item.img ? (
                    <img
                      src={item.img}
                      alt={item.imgAlt}
                      className="lp-sneak-img"
                      loading="lazy"
                    />
                  ) : null}
                </section>
                {item.title === "Found by Local Players" && <AllHallsMap />}
              </Fragment>
            ))}

            {/* ── How to get listed ── */}
            <section>
              <h2 className="lp-h2">{FOR_VENUES_HOWTO_TITLE}</h2>
              {FOR_VENUES_HOWTO_BODY.split("\n\n").map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </section>

            <nav className="lp-links" aria-label="Get your hall listed">
              <a className="btn btn-primary btn-big w-full" href={FOR_VENUES_MAILTO}>
                ✉ Request Your Venue
              </a>
            </nav>

            {/* ── FAQ ── */}
            <h2 className="lp-h2">Frequently Asked Questions (FAQ)</h2>
            <dl className="lp-faq">
              {FOR_VENUES_FAQ.map((f) => (
                <div key={f.q}>
                  <dt>{f.q}</dt>
                  <dd>{f.a}</dd>
                </div>
              ))}
            </dl>

            {/* ── More pages ── */}
            <nav className="lp-links" aria-label="More BreakBPM pages">
              <button className="btn btn-big w-full" onClick={onPasses}>
                Passes &amp; Pricing
              </button>
              <button className="btn btn-big w-full" onClick={onManual}>
                BreakBPM Manual
              </button>
            </nav>

            <LegalDisclosure />

            <p className="lp-footer">
              Built by Saym Services Inc. · Vancouver, BC
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
