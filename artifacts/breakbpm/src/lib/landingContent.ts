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

export interface ShowcaseItem {
  title: string;
  body: string;
  img: string;
  imgAlt: string;
}

export const POOL_STATS_H1 =
  "Nice Rack, Track It";

export const POOL_STATS_LORE =
  "Developed by Saym Software Systems in the late 1990s. Held back by the Y2K bug. Unreleased — until now.";

export const POOL_STATS_INTRO =
  "BreakBPM logs every shot, one ball at a time, and gives you two numbers back: your shooting accuracy and your Balls Per Minute. Free to play, nothing to install, works in any browser.";

export const POOL_STATS_MODES: NamedBlock[] = [
  {
    name: "8-Ball",
    body: "Stripes vs. solids with an open break",
  },
  {
    name: "9-Ball",
    body: "Rotation scoring with a 1–9 rack included",
  },
  {
    name: "Practice",
    body: "Solo drills and basic shot tracking",
  },
  {
    name: "Shark Mode",
    body: "Solo 8-ball against an invisible digital shark",
  },
];

export const POOL_STATS_SHOWCASE: ShowcaseItem[] = [
  {
    title: "Live Per-Player BPM — Ball by Ball",
    body: "The HUD updates on every shot. Pocket a ball and your Balls Per Minute ticks live — anchored at your first pocket, running to your last. One screen handles the score, the shot log, and the rack.",
    img: "/screenshot-home.gif",
    imgAlt: "BreakBPM live scoreboard — live BPM, accuracy, and the ball rack",
  },
  {
    title: "Face The Shark",
    body: "Shark Mode is solo 8-ball against an opponent you can't see. Normal aggression: the Shark steals a ball on every foul. Hard aggression: it steals on every miss and foul. The honour system keeps it honest — you lift the Shark's ball off the table yourself.",
    img: "/shark.jpg",
    imgAlt: "Shark Mode — solo 8-ball against an invisible opponent",
  },
  {
    title: "Stats That Sharpen the More You Play",
    body: "The CRT stats page shows accuracy, pace, and ball/pattern breakdowns over time. Sign in free to save your stats. Pass holders unlock the full history window, on-demand refresh, and a global BPM bell curve to see exactly where your pace ranks.",
    img: "/bpm-bell-curve.gif",
    imgAlt: "BPM bell curve — where your pace ranks against all players",
  },
  {
    title: "The Global BPM Leaderboard",
    body: "Ranked by accuracy-weighted pace across recent 1-on-1 games. Separate boards for 8-ball and 9-ball. You appear after just two qualifying games — show up, shoot straight, climb the board.",
    img: "/leaderboard-example.gif",
    imgAlt: "BreakBPM leaderboard — ranked players with BPM scores",
  },
  {
    title: "Play at a Verified Hall — Tag the Board",
    body: "Every Verified Hall on BreakBPM has its own House Leaderboard. Finish a game on location and tag it — BreakBPM confirms you're within 300m, then adds it to the hall's board. Find your local spot via Find Players.",
    img: "/hall-card-example.png",
    imgAlt: "Granville Club verified hall card with House Leaderboard button",
  },
];

export const POOL_STATS_SYSREQ: string[] = [
  "Any modern browser — Chrome, Safari, Firefox, Edge",
  "Works on mobile, tablet, and desktop",
  "No download. No install. No subscription required.",
  "Internet connection required to save stats and spectate",
];

export const POOL_STATS_FAQ: FaqItem[] = [
  {
    q: "What is BreakBPM?",
    a: "BreakBPM is a free, browser-based pool stats app and live billiards score tracker. It logs every shot one ball at a time and gives you two numbers — your shooting accuracy and your Balls Per Minute (BPM) — across 8-ball, 9-ball, practice, and solo Shark mode. Nothing to install.",
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
    a: "Yes. Every game has a 5-character share code. Others can join an open seat before the break or spectate by name — seeing your HUD, shot log, and live BPM but never scoring.",
  },
  {
    q: "How do I get a free pass?",
    a: "Claim one free pass per account from this page. Every claim is a guaranteed win: at minimum a Day pass, with a chance at a Lucky Break roll for a Monthly or even Lifetime pass, while monthly stock lasts.",
  },
];
