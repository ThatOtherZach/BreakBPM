import React, { useEffect } from "react";
import Navbar from "./Navbar";
import Footer from "./Footer";
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

const BALL_COLORS: Record<number, string> = {
  1: '#F7D700', 2: '#2255B0', 3: '#E03A2E', 4: '#6B2D8B',
  5: '#E07820', 6: '#1A7A3C', 7: '#8B1A1A', 8: '#222222',
  9: '#FDD307', 10: '#1F4E9E', 11: '#C3342B', 12: '#5B247A',
  13: '#F27C1D', 14: '#276B40', 15: '#6B1F2A',
};

function DecorativeBallRow() {
  const chip = (ball: number) => (
    <span
      key={ball}
      className={`hud-chip ${ball === 8 ? "hud-chip-eight" : ball <= 7 ? "hud-chip-solid" : "hud-chip-stripe"}`}
      data-number={ball}
      style={{ "--chip-color": BALL_COLORS[ball] } as React.CSSProperties}
    />
  );
  const rowStyle: React.CSSProperties = { display: "flex", gap: 3, justifyContent: "center" };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, margin: "10px 0 2px" }} aria-hidden="true">
      <div style={rowStyle}>{[1].map(chip)}</div>
      <div style={rowStyle}>{[2, 3].map(chip)}</div>
      <div style={rowStyle}>{[4, 8, 5].map(chip)}</div>
      <div style={rowStyle}>{[6, 7, 9, 10].map(chip)}</div>
      <div style={rowStyle}>{[11, 12, 13, 14, 15].map(chip)}</div>
    </div>
  );
}

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
  onManual: () => void;
  onAccount: () => void;
  onStats: () => void;
  onFindPlayers: () => void;
  onSignIn: () => void;
  onPasses: () => void;
  onLegal: () => void;
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
  onManual,
  onAccount,
  onStats,
  onFindPlayers,
  onSignIn,
  onPasses,
  onLegal,
}: Props) {
  usePageMeta(PAGE_META.poolStatsApp);

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
              <span aria-hidden="true">🎱</span>BreakBPM.com
            </span>
          </div>
          <div className="panel-body lp-body">

            {/* ── Front of the box ── */}
            <h1 className="lp-h1 text-center">{POOL_STATS_H1}</h1>
            <p className="lp-lore">{POOL_STATS_LORE}</p>
            <p className="lp-intro">{POOL_STATS_INTRO}</p>

            <button className="btn btn-primary btn-big w-full" onClick={onHome}>
              <span className="cue-ball-icon" style={{ fontSize: 16 }} aria-hidden="true" /> Start Tracking Your Shots Today
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
                {item.liveLeaderboard ? <LeaderboardWidget /> : null}
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

            {/* ── Spectate & share (mood shot) ── */}
            <img
              src="/hustler.jpg"
              alt="A seasoned player leans over the table, cue in hand"
              className="lp-img"
            />
            <section>
              <h2 className="lp-h2">Spectate &amp; Share Your Stats</h2>
              <p>Every game has a join code. Friends can join an open seat before the break or spectate by name after. See your live HUD, shot log, and BPM in real time, on your device. Link a registered friend with an @mention before breaking! If you have a pass you get access to an OBS overlay URL for streaming your scores.</p>
            </section>

            {/* ── System requirements ── */}
            <div className="lp-sysreq">
              <h2 className="lp-h2 lp-sysreq__heading">System Requirements</h2>
              <p className="mt-[5px] mb-[5px]">
                {POOL_STATS_SYSREQ.map((r, i, arr) => (
                  <React.Fragment key={r}>{r}{i < arr.length - 1 && <br />}</React.Fragment>
                ))}
              </p>
            </div>

            {/* ── Nav links ── */}
            <nav className="lp-links" aria-label="More BreakBPM pages">
              <button className="btn btn-big w-full" onClick={onPasses}>
                Passes &amp; Pricing
              </button>
              <button className="btn btn-big w-full" onClick={onManual}>
                BreakBPM Manual
              </button>
            </nav>

            <DecorativeBallRow />

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
      <Footer onLegal={onLegal} />
    </div>
  );
}
