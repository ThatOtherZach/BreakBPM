import { useEffect } from "react";
import Navbar from "./Navbar";
import FreePassCTA from "./FreePassCTA";
import LegalDisclosure from "./LegalDisclosure";
import { LeaderboardWidget } from "./LeaderboardScreen";
import { VenueCard } from "./FindPlayersScreen";
import { useListVenues, getListVenuesQueryKey } from "@workspace/api-client-react";
import { usePageMeta, PAGE_META } from "../lib/pageMeta";
import {
  POOL_STATS_H1,
  POOL_STATS_LORE,
  POOL_STATS_INTRO,
  POOL_STATS_MODES,
  POOL_STATS_SHOWCASE,
  POOL_STATS_SYSREQ,
  POOL_STATS_FAQ,
} from "../lib/landingContent";

function LatestHallWidget({
  fallbackImg,
  fallbackAlt,
}: {
  fallbackImg?: string;
  fallbackAlt?: string;
}) {
  const { data } = useListVenues(
    { page: 1, limit: 1 },
    { query: { queryKey: getListVenuesQueryKey({ page: 1, limit: 1 }) } },
  );
  const venue = data?.venues?.[0];
  if (venue) return <VenueCard venue={venue} distanceKm={null} />;
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

interface Props {
  onHome: () => void;
  onAbout: () => void;
  onAccount: () => void;
  onStats: () => void;
  onFindPlayers: () => void;
  onSignIn: () => void;
  onPasses: () => void;
}

/**
 * SEO/LLM-crawlable marketing landing page at `/pool-stats-app`. The build-time
 * prerenderer (vite.config.ts) emits a static, keyword-rich HTML version of this
 * same copy (sourced from `landingContent.ts`) plus SoftwareApplication + FAQPage
 * JSON-LD, so crawlers without JS still get the full page. Once the bundle loads,
 * this interactive version takes over and embeds the live free-pass claim CTA,
 * live leaderboard widget, and back-of-the-box UI sneak peeks.
 */
export default function PoolStatsAppScreen({
  onHome,
  onAbout,
  onAccount,
  onStats,
  onFindPlayers,
  onSignIn,
  onPasses,
}: Props) {
  usePageMeta(PAGE_META.poolStatsApp);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="app-window app-window--page">
      <Navbar
        onBack={onHome}
        onAbout={onAbout}
        onAccount={onAccount}
        onStats={onStats}
        onFindPlayers={onFindPlayers}
        onSignIn={onSignIn}
      />
      <div className="app-body">
        <div className="panel">
          <div className="panel-header">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden="true" className="ball-btn eight" style={{ width: 16, height: 16, flexShrink: 0, pointerEvents: 'none' }}><span className="ball-num" style={{ width: 12, height: 12, fontSize: 7 }}>8</span></span>BreakBPM.com
            </span>
          </div>
          <div className="panel-body lp-body">

            {/* ── Front of the box ── */}
            <h1 className="lp-h1 text-center">{POOL_STATS_H1}</h1>
            <p className="lp-lore">{POOL_STATS_LORE}</p>
            <p className="lp-intro">{POOL_STATS_INTRO}</p>

            <button className="btn btn-primary btn-big w-full" onClick={onHome}>
              ▶ Start Scoring — It's Free
            </button>

            <img
              src="/breakbpm-poster.png"
              alt="BreakBPM — PC-98 Series Billiards Score Tracker"
              className="lp-img"
            />

            {/* ── Free pass claim ── */}
            <FreePassCTA />

            {/* ── Back of the box: UI sneak peeks ── */}
            {POOL_STATS_SHOWCASE.map((item) => (
              <section key={item.title} className="lp-feature">
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
            ))}

            {/* ── Game modes ── */}
            <h2 className="lp-h2">Four Ways to Play</h2>
            <div className="game-type-grid lp-mode-grid">
              {POOL_STATS_MODES.map((m) => (
                <button key={m.name} className="btn type-btn lp-mode-btn" onClick={onHome}>
                  <span className="type-btn-label">{m.name}</span>
                  <span className="type-btn-desc lp-mode-btn__desc">{m.body}</span>
                </button>
              ))}
            </div>

            {/* ── Live leaderboard sneak peek ── */}
            <LeaderboardWidget />

            {/* ── Spectate & share (mood shot) ── */}
            <img
              src="/hustler.jpg"
              alt="A seasoned player leans over the table, cue in hand"
              className="lp-img"
            />
            <section>
              <h2 className="lp-h2">Spectate &amp; Share Your Stats</h2>
              <p>Every game gets a 5-character share code. Friends can join an open seat before the break or spectate by name — seeing your live HUD, shot log, and BPM in real time. Link a registered friend with an @mention; no shared device needed. Going live? Grab the transparent OBS overlay URL from your Account page and drop it straight into OBS.</p>
            </section>

            {/* ── System requirements ── */}
            <div className="lp-sysreq">
              <h2 className="lp-h2 lp-sysreq__heading">System Requirements</h2>
              <ul className="lp-list">
                {POOL_STATS_SYSREQ.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>

            {/* ── Nav links ── */}
            <nav className="lp-links" aria-label="More BreakBPM pages">
              <button className="btn btn-big w-full" onClick={onPasses}>
                Passes &amp; Pricing
              </button>
              <button className="btn btn-big w-full" onClick={onAbout}>
                About BreakBPM
              </button>
            </nav>

            {/* ── FAQ ── */}
            <h2 className="lp-h2">Frequently Asked Questions (FAQ)</h2>
            <dl className="lp-faq">
              {POOL_STATS_FAQ.map((f) => (
                <div key={f.q}>
                  <dt>{f.q}</dt>
                  <dd>{f.a}</dd>
                </div>
              ))}
            </dl>

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
