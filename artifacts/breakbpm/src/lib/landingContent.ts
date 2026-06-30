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
  img?: string;
  imgAlt?: string;
  /** When true, the screen renders a live widget (the latest verified hall),
   *  falling back to `img` when there is no live data yet. */
  liveHall?: boolean;
  /** When true, the screen renders the live LeaderboardWidget after the image. */
  liveLeaderboard?: boolean;
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
    body: "Log every shot as you pocket them minute by minute; from the first to the last. Just pick the mode and get started!",
    img: "/screenshot-home.gif",
    imgAlt: "BreakBPM live scoreboard — live BPM, accuracy, and the ball rack",
  },
  {
    title: "Face The Shark",
    body: "Shark Mode is for solo 8-ball players verses The Shark (CPU). Set the aggression and break the rack! The Shark will steal a ball on every foul, or in every miss AND foul. When that happens, just remove a ball from the table. It's honour system based, so be honest.",
    img: "/shark.jpg",
    imgAlt: "Shark Mode — solo 8-ball against an invisible opponent",
  },
  {
    title: "Stats That Sharpen the More You Play",
    body: "The Stats page shows accuracy, pace, and ball/pattern breakdowns over time. You can play for free, but you need to sign in to save your stats. Pass holders unlock the full history, on-demand refresh, and more!",
    img: "/bpm-bell-curve.gif",
    imgAlt: "BPM bell curve — where your pace ranks against all players",
  },
  {
    title: "The Global BPM Leaderboard",
    body: "Ranked by pace across recent 1-on-1 games with separate leaderboards for 8-ball and 9-ball. Users qualify after just two games. Show up, shoot, and climb the board!",
    liveLeaderboard: true,
  },
  {
    title: "Themes & Customization",
    body: "Earn themes by playing and winning. Lifetime pass holders get custom screen names and a rainbow leaderboard effect. Your card shows wins, BPM, accuracy, and Shark Level.",
    img: "/leaderboard-example.gif",
    imgAlt: "BreakBPM profile themes and customization",
  },
  {
    title: "Play at a Verified Hall — Tag the Board",
    body: "Every Verified Hall on BreakBPM has its own Leaderboard. Finish a game on location and tag it. Need a hall? Find your local spot via Find Players after logging in.",
    img: "/hall-card-example.png",
    imgAlt: "Granville Club verified hall card with Local Leaderboard button",
    liveHall: true,
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

/* ───────────────────────── For Venues (venue-owner pitch) ─────────────────────────
 * Shared copy for the `/for-venues` page. Imported by BOTH the React screen
 * (`ForVenuesScreen.tsx`) and the build-time prerenderer (`vite.config.ts`),
 * so the human-visible page, the crawler-visible static HTML, and the FAQPage
 * JSON-LD stay in lockstep. Keep it plain data (no React) for build-time import.
 */

export const FOR_VENUES_H1 = "Put Your Hall on the Board";

export const FOR_VENUES_TAGLINE =
  "A free listing for pool halls — all we ask is one social media post.";

export const FOR_VENUES_INTRO =
  "BreakBPM is a free Billiards scoring app players can use right at the table. Track your BPM (Balls Per Minute), accuracy against the global and local leaderboards at Verified Pool Halls. A zero upkeep, complete scoring and ranking system built for your pool tables.";

export const FOR_VENUES_SHOWCASE: ShowcaseItem[] = [
  {
    title: "Your Own Local Leaderboard",
    body: "Every verified hall gets its own Local Leaderboard. Regulars battle for the top spot on your tables, and a walk-in just scans the code to get on the board. It's league-night standings that run themselves.",
    img: "/hall-card-example.png",
    imgAlt: "A verified hall card with its own Local Leaderboard button",
    liveHall: true,
  },
  {
    title: "Found by Local Players",
    body: "Your hall shows up as a starred pin on the map, points the in-app compass toward you for nearby players, and climbs the Most Popular Venues list as games rack up. Players hunting for a table find you.",
  },
  {
    title: "A Link Back to Your Place",
    body: "Your hall page links straight to your website and opens you in Google Maps — a little extra online visibility that sends players right to your door.",
  },
  {
    title: "The Scoreboard They'll Actually Use",
    body: "That dusty bead string over the table? This is the version your players keep on their phones. No hardware, no setup, no cost to you.",
  },
];

export const FOR_VENUES_ASK_TITLE = "The Whole Deal";

export const FOR_VENUES_ASK_BODY =
  "We list your hall for free. You post once on social media — tag #BreakBPM and link to your hall's leaderboard page. Any platform works. That's it.";

export const FOR_VENUES_HOWTO_TITLE = "How to Get Listed";

export const FOR_VENUES_HOWTO_BODY =
  "Get verified for free! We only ask that you post on social media with the tag #BreakBPM and a link to your BreakBPM leaderboard.\n\nEmail us your venue's name, address, number of tables, and a website if you have one. Verification takes 1-3 business days.";

export const FOR_VENUES_CTA_LABEL = "Request to be Added";

export const FOR_VENUES_MAILTO =
  "mailto:contact@saymservices.com?subject=Verified%20Pool%20Hall%20Request";

export const FOR_VENUES_FAQ: FaqItem[] = [
  {
    q: "What does it cost to list my pool hall?",
    a: "Nothing. A verified hall listing on BreakBPM is free. In exchange, we ask for one social media post — tag #BreakBPM and link to your hall's leaderboard page on any platform.",
  },
  {
    q: "What do my players get?",
    a: "Their own Local Leaderboard for your tables, free score tracking with live Balls Per Minute and accuracy, and an easy way to find your hall inside the app.",
  },
  {
    q: "How do games get added to my hall's leaderboard?",
    a: "A player finishes a 1-on-1 game on-site and tags it to your hall — a quick on-location check-in. Those games rank players on your hall's Local Leaderboard.",
  },
  {
    q: "How do I get my hall listed?",
    a: "Email us your hall's name, address, table count, and website (if you have one). Our team adds verified halls by hand, usually within a day or two.",
  },
  {
    q: "Can I update or remove my listing later?",
    a: "Yes. Just email us and we'll update your hall's details or remove the listing.",
  },
];
