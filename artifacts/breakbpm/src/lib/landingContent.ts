/**
 * Shared copy for the `/pool-stats-app` marketing landing page.
 *
 * This module is imported by BOTH the React screen (`PoolStatsAppScreen.tsx`)
 * and the build-time prerenderer (`vite.config.ts`), so the human-visible page,
 * the crawler-visible static HTML, and the FAQPage JSON-LD all stay in lockstep.
 * Google requires FAQ rich-result markup to match the on-page text, so the FAQ
 * in particular MUST be sourced from here in both places — never hand-duplicated.
 *
 * Keep this file dependency-free (plain data only) so the Vite config can import
 * it at build time without pulling in React.
 */

export interface FaqItem {
  q: string;
  a: string;
}

export interface NamedBlock {
  name: string;
  body: string;
}

export interface TitledBlock {
  title: string;
  body: string;
}

export const POOL_STATS_H1 =
  "Nice Rack, Track It";

export const POOL_STATS_INTRO =
  "BreakBPM is a a free, browser-based pool stats app and live billiards score tracker. Log every shot and measure your shooting accuracy and Balls Per Minute (BPM score, No download, no install, no subscription.";

export const POOL_STATS_MODES: NamedBlock[] = [
  {
    name: "8-Ball",
    body: "Straight Pool Rules with Open Break",
  },
  {
    name: "9-Ball",
    body: "Rotation scoring with a 1-9 rack included",
  },
  {
    name: "Practice",
    body: "For solo drills and basic tracking",
  },
  {
    name: "Shark Mode",
    body: "Solo 8-Ball with a digital shark player",
  },
];

export const POOL_STATS_FEATURES: TitledBlock[] = [
  {
    title: "What is Balls Per Minute (BPM)?",
    body: "The clock starts at your first pocketed ball and runs to your latest, so BPM measures how fast you clear — not how long you spent racking. Compare runs and read your pace shot by shot.",
  },
  {
    title: "Live scoreboard, spectating & OBS overlay",
    body: "Every game gets a 5-character share code. Friends join an open seat or spectate by name — your HUD, shot log, and live BPM, view-only. Streamers get a chrome-free, transparent OBS overlay.",
  },
  {
    title: "Stats that deepen the more you play",
    body: "Per-player history, accuracy, pace, and ball/pattern breakdowns on a retro CRT stats page. A pass unlocks longer windows, full history, a global leaderboard, and @mention player linking.",
  },
];

export const POOL_STATS_FAQ: FaqItem[] = [
  {
    q: "What is BreakBPM?",
    a: "The clock starts at your first pocketed ball and runs to your latest, so BPM measures how fast you clear — not how long you spent racking. Compare runs and read your pace shot by shot.",
  },
  {
    q: "What does Balls Per Minute (BPM) mean?",
    a: "How fast you pocket balls once you get going. The clock anchors at your first pocketed ball and runs to your latest, so you can compare runs and track improvement.",
  },
  {
    q: "Which pool game modes does BreakBPM support?",
    a: "8-ball (2 or 4 players with teams), 9-ball, solo Practice drills, and a single-player Shark mode against an invisible AI that steals balls on your misses and fouls.",
  },
  {
    q: "Is BreakBPM free to use?",
    a: "Yes — playing and scoring is free forever, with nothing to install. Signing in saves your stats and history, and optional passes unlock full history, longer stats windows, and live spectating.",
  },
  {
    q: "Can other people watch my pool game live?",
    a: "Yes. Every game has a 5-character share code. Others can join an open seat before the break or spectate by name — seeing your HUD, shot log, and live BPM but never scoring. There's also an OBS overlay for streamers.",
  },
  {
    q: "How do I get a free pass?",
    a: "Claim one free pass per account from this page. Every claim is a guaranteed win: at minimum a Day pass, with a chance at a Lucky Break roll for a Monthly or even Lifetime pass, while monthly stock lasts.",
  },
];
