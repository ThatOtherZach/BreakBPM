import { useEffect } from "react";
import Navbar from "./Navbar";
import FreePassCTA from "./FreePassCTA";
import LegalDisclosure from "./LegalDisclosure";
import { LeaderboardWidget } from "./LeaderboardScreen";
import { usePageMeta, PAGE_META } from "../lib/pageMeta";
import {
  POOL_STATS_H1,
  POOL_STATS_INTRO,
  POOL_STATS_MODES,
  POOL_STATS_FEATURES,
  POOL_STATS_FAQ,
} from "../lib/landingContent";

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
 * this interactive version takes over and embeds the live free-pass claim CTA.
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

  // app-window--page scrolls the document — land at the top on entry.
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
              <span aria-hidden="true">🎱</span>Pool Stats App
            </span>
          </div>
          <div className="panel-body lp-body">
            <h1 className="lp-h1">{POOL_STATS_H1}</h1>
            <p className="lp-intro">{POOL_STATS_INTRO}</p>

            <FreePassCTA />

            <button className="btn btn-primary btn-big w-full" onClick={onHome}>
              ▶ Start Scoring — It's Free
            </button>

            <img src="/breakbpm-poster.png" alt="BreakBPM — PC-98 Series Billiards Score Tracker" className="lp-img" />

            <h2 className="lp-h2">Track Every Shot Across Every Pool Game</h2>
            <div className="game-type-grid lp-mode-grid">
              {POOL_STATS_MODES.map((m) => (
                <button key={m.name} className="btn type-btn lp-mode-btn" onClick={onHome}>
                  <span className="type-btn-label">{m.name}</span>
                  <span className="type-btn-desc lp-mode-btn__desc">{m.body}</span>
                </button>
              ))}
            </div>

            {POOL_STATS_FEATURES.map((f) => (
              <section key={f.title}>
                <h2 className="lp-h2">{f.title}</h2>
                <p>{f.body}</p>
              </section>
            ))}

            <LeaderboardWidget />

            <img src="/pool-player.jpg" alt="Player lining up a shot" className="lp-img" />

            <nav className="lp-links" aria-label="More BreakBPM pages">
              <button className="btn btn-big w-full" onClick={onPasses}>
                Passes &amp; Pricing
              </button>
              <button className="btn btn-big w-full" onClick={onAbout}>
                About BreakBPM
              </button>
            </nav>

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
