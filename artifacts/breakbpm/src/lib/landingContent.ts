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
  "The Pool Stats App That Measures Your Balls Per Minute";

export const POOL_STATS_INTRO =
  "BreakBPM is a free, browser-based pool stats app and live billiards score tracker. Log every shot one ball at a time and get two numbers that actually describe your game: shooting accuracy and Balls Per Minute (BPM) — your live scoring pace. No download, no app store, nothing to install.";

export const POOL_STATS_MODES: NamedBlock[] = [
  {
    name: "8-Ball",
    body: "2-player or 4-player with team assignment, tracking solids and stripes all the way down to the 8.",
  },
  {
    name: "9-Ball",
    body: "Rotation scoring with per-shot pace stamped on every pocketed ball.",
  },
  {
    name: "Practice",
    body: "Solo drills to dial in your stroke and your pace at your own speed.",
  },
  {
    name: "Shark Mode",
    body: "Solo 8-ball against an invisible AI that steals balls on your misses and fouls.",
  },
];

export const POOL_STATS_FEATURES: TitledBlock[] = [
  {
    title: "What is Balls Per Minute (BPM)?",
    body: "Balls Per Minute is a pace metric unique to BreakBPM. The clock anchors at your first pocketed ball and measures to your most recent one, so BPM captures how fast you clear once you get going — not how long you spent racking. Compare runs, track improvement, and read your pace shot by shot in the log.",
  },
  {
    title: "Live scoreboard, spectating & OBS overlay",
    body: "Every game gets a 5-character share code. Friends can join an open seat before the break or spectate any player's live game by name — they see the host's HUD, shot log, and live BPM but can't score. Streamers can drop a chrome-free, transparent OBS overlay straight into a Browser Source.",
  },
  {
    title: "Stats that deepen the more you play",
    body: "BreakBPM keeps per-player history, accuracy, pace, and ball- and pattern-breakdowns on a retro CRT-styled stats page. Free accounts see recent stats; a pass unlocks longer windows, full game history, a global leaderboard, and @mention player linking.",
  },
];

export const POOL_STATS_FAQ: FaqItem[] = [
  {
    q: "What is BreakBPM?",
    a: "BreakBPM is a free, browser-based pool stats app and billiards score tracker. It logs every shot one ball at a time and reports two numbers for each player: shooting accuracy and Balls Per Minute (BPM), a live measure of scoring pace.",
  },
  {
    q: "What does Balls Per Minute (BPM) mean?",
    a: "Balls Per Minute is how fast a player pockets balls once they get going. BreakBPM anchors the clock at your first pocketed ball and measures your pace to your most recent one, so you can compare runs and track improvement over time.",
  },
  {
    q: "Which pool game modes does BreakBPM support?",
    a: "BreakBPM supports 8-ball (2 or 4 players, with team assignment), 9-ball, solo Practice drills, and a single-player Shark mode that pits you against an invisible AI opponent that steals balls on your misses and fouls.",
  },
  {
    q: "Is BreakBPM free to use?",
    a: "Yes. Playing and scoring games is free forever, with nothing to install. Signing in saves your stats and history, and optional passes unlock full game history, extended stats windows, live spectating, and more.",
  },
  {
    q: "Can other people watch my pool game live?",
    a: "Yes. Every game has a 5-character share code. Others can join an open seat before the break or spectate a player's live game by name — they see the host's HUD, shot log, and live BPM but can't score. There is also a chrome-free OBS overlay for streamers.",
  },
  {
    q: "How do I get a free pass?",
    a: "New players can claim one free pass per account from the landing page. Every claim is a guaranteed win: at minimum a Day pass, with a chance at a Lucky Break roll for a Monthly or even Lifetime pass, while the monthly free stock lasts.",
  },
];
