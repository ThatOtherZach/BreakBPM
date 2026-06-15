import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "node:fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { createRequire } from "module";
import type { Plugin } from "vite";
import {
  POOL_STATS_H1,
  POOL_STATS_INTRO,
  POOL_STATS_MODES,
  POOL_STATS_FEATURES,
  POOL_STATS_FAQ,
} from "./src/lib/landingContent";
const require = createRequire(import.meta.url);
const { version } = require("./package.json") as { version: string };

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

interface RouteMetaEntry {
  path: string;
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  /** Optional per-route JSON-LD. When set, replaces the index.html structured-data block. */
  jsonLd?: string;
}

const PUBLIC_ROUTES: RouteMetaEntry[] = [
  {
    path: "about",
    title: "About BreakBPM — Billiards Score Tracker & Shot Stats App",
    description:
      "Learn about BreakBPM — the free live pool scorekeeper that calculates per-player Balls Per Minute for 8-ball, 9-ball, and solo Shark mode. Built for serious players.",
    canonical: "https://breakbpm.com/about",
    ogTitle: "About BreakBPM — Billiards Score Tracker & Shot Stats",
    ogDescription:
      "BreakBPM tracks every shot and every ball pocketed, calculating live Balls Per Minute per player. Learn how it works and who made it.",
  },
  {
    path: "legal",
    title: "Legal — BreakBPM Terms of Service, Privacy & Data Policy",
    description:
      "BreakBPM terms of service, privacy policy, and data handling details. Read how we collect, store, and protect your game data.",
    canonical: "https://breakbpm.com/legal",
    ogTitle: "Legal — BreakBPM Terms & Privacy Policy",
    ogDescription:
      "BreakBPM terms of service, privacy policy, and data handling details.",
  },
  {
    path: "passes",
    title:
      "BreakBPM Passes & Pricing — Day Pass, Monthly, Lifetime Access",
    description:
      "Unlock full stats history, live spectating, and all BreakBPM features. Choose a Day Pass ($1.99), Monthly ($2.99/mo), Yearly ($12.99/yr), or Lifetime ($24.99) pass.",
    canonical: "https://breakbpm.com/passes",
    ogTitle:
      "BreakBPM Passes & Pricing — Unlock Full Stats & Spectating",
    ogDescription:
      "Choose a Day Pass ($1.99), Monthly sub ($2.99/mo), or Lifetime pass ($24.99) to unlock full stats history, live spectating, and all paid BreakBPM features.",
  },
  {
    path: "pool-stats-app",
    title:
      "Pool Stats App — Track Balls Per Minute for 8-Ball & 9-Ball | BreakBPM",
    description:
      "BreakBPM is a free pool stats app and live billiards score tracker. Log every shot and see per-player Balls Per Minute (BPM) for 8-ball, 9-ball, practice, and Shark mode. Claim a free pass.",
    canonical: "https://breakbpm.com/pool-stats-app",
    ogTitle: "BreakBPM — The Pool Stats App with Balls Per Minute",
    ogDescription:
      "Free pool stats app & billiards score tracker. Track accuracy and live Balls Per Minute across 8-ball, 9-ball, practice, and solo Shark mode.",
    jsonLd: poolStatsAppJsonLd(),
  },
];

function injectRouteMeta(html: string, route: RouteMetaEntry): string {
  let out = html
    .replace(
      /<title>[^<]*<\/title>/,
      `<title>${route.title}</title>`,
    )
    .replace(
      /<meta name="description" content="[^"]*"/,
      `<meta name="description" content="${route.description}"`,
    )
    .replace(
      /<link rel="canonical" href="[^"]*"/,
      `<link rel="canonical" href="${route.canonical}"`,
    )
    .replace(
      /<meta property="og:title" content="[^"]*"/,
      `<meta property="og:title" content="${route.ogTitle}"`,
    )
    .replace(
      /<meta property="og:description" content="[^"]*"/,
      `<meta property="og:description" content="${route.ogDescription}"`,
    )
    .replace(
      /<meta property="og:url" content="[^"]*"/,
      `<meta property="og:url" content="${route.canonical}"`,
    )
    .replace(
      /<meta name="twitter:title" content="[^"]*"/,
      `<meta name="twitter:title" content="${route.ogTitle}"`,
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*"/,
      `<meta name="twitter:description" content="${route.ogDescription}"`,
    );

  if (route.jsonLd) {
    const jsonLd = route.jsonLd;
    out = out.replace(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      () => jsonLd,
    );
  }

  return out;
}

/** Minimal inline styles to make the static prerendered body legible without
 *  loading the app bundle. These are only visible to non-JS crawlers. */
const PRERENDER_STYLE = `
  <style>
    #prerender-static{font-family:sans-serif;max-width:680px;margin:0 auto;padding:16px 20px;color:#111;line-height:1.6}
    #prerender-static h1{font-size:1.6rem;margin:0 0 4px}
    #prerender-static h2{font-size:1.2rem;margin:1.2em 0 .4em;border-bottom:1px solid #ddd;padding-bottom:4px}
    #prerender-static h3{font-size:1rem;margin:1em 0 .3em}
    #prerender-static p,#prerender-static li{font-size:.9rem;margin:.4em 0}
    #prerender-static ul{padding-left:1.4em}
    #prerender-static table{border-collapse:collapse;width:100%;font-size:.85rem;margin:1em 0}
    #prerender-static th,#prerender-static td{border:1px solid #ccc;padding:6px 10px;text-align:left}
    #prerender-static .plan-row{border:1px solid #aaa;padding:10px 14px;margin:.6em 0;border-radius:4px}
    #prerender-static .plan-price{font-weight:bold;float:right}
    #prerender-static .plan-note{font-size:.8rem;color:#555}
    #prerender-static nav{margin-bottom:16px;font-size:.85rem}
    #prerender-static nav a{color:#000080;text-decoration:none;margin-right:12px}
  </style>
`.trim();

function buildAboutBody(markedFn: (md: string) => string): string {
  const aboutMd = fs.readFileSync(
    path.resolve(import.meta.dirname, "src/ABOUT.md"),
    "utf-8",
  );
  const aboutHtml = markedFn(aboutMd);
  return `
${PRERENDER_STYLE}
<div id="prerender-static">
  <nav><a href="/">← Home</a><a href="/passes">Passes &amp; Pricing</a><a href="/legal">Legal</a></nav>
  ${aboutHtml}
  <p style="margin-top:2em;font-size:.8rem;color:#888">Built by Saym Services Inc. · Vancouver, BC</p>
</div>`.trim();
}

function buildLegalBody(markedFn: (md: string) => string): string {
  const termsMd = fs.readFileSync(
    path.resolve(import.meta.dirname, "src/legal/TERMS_OF_SERVICE.md"),
    "utf-8",
  );
  const dataMd = fs.readFileSync(
    path.resolve(import.meta.dirname, "src/legal/DATA_POLICY.md"),
    "utf-8",
  );
  const termsHtml = markedFn(termsMd);
  const dataHtml = markedFn(dataMd);
  return `
${PRERENDER_STYLE}
<div id="prerender-static">
  <nav><a href="/">← Home</a><a href="/about">About</a><a href="/passes">Pricing</a></nav>
  <h1>Legal</h1>
  <p style="font-size:.85rem;color:#555">Terms of service, privacy policy, and data handling details for BreakBPM — operated by Saym Services Inc.</p>
  ${termsHtml}
  ${dataHtml}
</div>`.trim();
}

function buildPassesBody(): string {
  const plans = [
    { name: "Day Pass", price: "$1.99", suffix: "", desc: "24 hours of full access — stats, history, live spectating, and all paid features.", note: "" },
    { name: "Monthly", price: "$2.99", suffix: "/mo", desc: "Full access month to month.", note: "Renews monthly · cancel anytime" },
    { name: "Yearly", price: "$12.99", suffix: "/yr", desc: "Full access for a full year at the best recurring rate.", note: "Renews yearly · cancel anytime" },
    { name: "Lifetime", price: "$24.99", suffix: "", desc: "One-time purchase. Pay once, full access forever, including a custom screen name.", note: "" },
  ];
  const planRows = plans.map(p =>
    `<div class="plan-row">
      <span class="plan-price">${p.price}${p.suffix ? `<span style="font-weight:normal;font-size:.85em">${p.suffix}</span>` : ""}</span>
      <strong>${p.name}</strong>
      <p>${p.desc}</p>
      ${p.note ? `<p class="plan-note">↻ ${p.note}</p>` : ""}
    </div>`
  ).join("\n");

  return `
${PRERENDER_STYLE}
<div id="prerender-static">
  <nav><a href="/">← Home</a><a href="/about">About</a><a href="/legal">Legal</a></nav>
  <h1>BreakBPM Passes &amp; Pricing</h1>
  <p>A pass unlocks full stats history, extended windows, live game spectating, @mention player linking, leaderboard windows, and all paid features. Free play is always available — sign in to save your stats.</p>

  <h2>Plans</h2>
  ${planRows}

  <h2>Pass Benefits</h2>
  <ul>
    <li><strong>Full game history</strong> — see every game you've ever played (free: last 24 h only)</li>
    <li><strong>Full stats windows</strong> — 24 h, 30 d, 365 d, all-time, with on-demand refresh</li>
    <li><strong>Live spectating</strong> — paid hosts can be watched live by anyone via share code or player name</li>
    <li><strong>Post to Find Players</strong> — create meetup posts; free accounts can browse only</li>
    <li><strong>Link players by @mention</strong> — invite friends to your game without a share code</li>
    <li><strong>Leaderboard windows</strong> — 90-day or all-time (free: 30-day only)</li>
    <li><strong>Full data export</strong> — download every game and shot ever played</li>
    <li><strong>Custom screen name</strong> (Lifetime only) — pick your own display name</li>
  </ul>

  <h2>Lucky Break — Roll the Rack</h2>
  <p>A $4.99 guaranteed upgrade: redeem a Lucky Break code for at minimum a 30-day Monthly Pass, with a 20% chance of a Lifetime Pass. The outcome is determined by a provably-fair seeded draw using the last 30 days of global shot activity.</p>

  <h2>How to Get a Pass</h2>
  <p>Sign in at <a href="https://breakbpm.com">breakbpm.com</a> and redeem a code from your Account page, or use a Lucky Break code link. Card checkout and cryptocurrency payment are also available when enabled.</p>

  <p style="margin-top:1.5em;font-size:.8rem;color:#888">All passes are non-refundable. For support, open an issue on GitHub.</p>
</div>`.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** SoftwareApplication + FAQPage structured data for the landing page.
 *  FAQ entries are sourced from the shared landingContent module so the markup
 *  matches the on-page (and prerendered) FAQ text Google requires for rich results. */
function poolStatsAppJsonLd(): string {
  const softwareApp = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "BreakBPM — Pool Stats App",
    url: "https://breakbpm.com/pool-stats-app",
    description:
      "BreakBPM is a free pool stats app and billiards score tracker that calculates per-player Balls Per Minute (BPM) for 8-ball, 9-ball, practice, and solo Shark mode.",
    applicationCategory: "SportsApplication",
    applicationSubCategory: "Billiards Score Tracker",
    operatingSystem: "Any",
    browserRequirements:
      "Requires a modern web browser with JavaScript enabled.",
    image: "https://breakbpm.com/opengraph.jpg",
    inLanguage: "en",
    isAccessibleForFree: true,
    creator: {
      "@type": "Organization",
      name: "Saym Services Inc.",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Vancouver",
        addressCountry: "CA",
      },
    },
    offers: [
      { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD", description: "Free to play forever. Sign in to save stats." },
      { "@type": "Offer", name: "Day Pass", price: "1.99", priceCurrency: "USD", description: "24 hours of full access." },
      { "@type": "Offer", name: "Monthly", price: "2.99", priceCurrency: "USD", description: "Full access, month to month." },
      { "@type": "Offer", name: "Yearly", price: "12.99", priceCurrency: "USD", description: "Full access for a year." },
      { "@type": "Offer", name: "Lifetime", price: "24.99", priceCurrency: "USD", description: "One-time purchase, full access forever." },
    ],
  };
  const faqPage = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: POOL_STATS_FAQ.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  const json = JSON.stringify([softwareApp, faqPage]).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

function buildPoolStatsAppBody(): string {
  const modes = POOL_STATS_MODES.map(
    (m) =>
      `  <li><strong>${escapeHtml(m.name)}</strong> — ${escapeHtml(m.body)}</li>`,
  ).join("\n");
  const features = POOL_STATS_FEATURES.map(
    (f) => `  <h2>${escapeHtml(f.title)}</h2>\n  <p>${escapeHtml(f.body)}</p>`,
  ).join("\n");
  const faq = POOL_STATS_FAQ.map(
    (f) => `  <h3>${escapeHtml(f.q)}</h3>\n  <p>${escapeHtml(f.a)}</p>`,
  ).join("\n");

  return `
${PRERENDER_STYLE}
<div id="prerender-static">
  <nav><a href="/">← Home</a><a href="/passes">Passes &amp; Pricing</a><a href="/about">About</a><a href="/legal">Legal</a></nav>
  <h1>${escapeHtml(POOL_STATS_H1)}</h1>
  <p>${escapeHtml(POOL_STATS_INTRO)}</p>
  <p><strong><a href="/claim">Claim your free pass</a></strong> — every claim is a guaranteed win, from a Day pass up to a Lifetime pass via a Lucky Break roll, while the monthly free stock lasts.</p>

  <h2>Track every shot across every pool game mode</h2>
  <ul>
${modes}
  </ul>

${features}

  <h2>Frequently asked questions</h2>
${faq}

  <p style="margin-top:2em;font-size:.8rem;color:#888">Built by Saym Services Inc. · Vancouver, BC · <a href="/">Open BreakBPM</a></p>
</div>`.trim();
}

function routeMetaPlugin(): Plugin {
  return {
    name: "route-meta-prerender",
    apply: "build",
    async closeBundle() {
      const outDir = path.resolve(import.meta.dirname, "dist/public");
      const indexPath = path.join(outDir, "index.html");
      if (!fs.existsSync(indexPath)) return;

      const indexHtml = fs.readFileSync(indexPath, "utf-8");

      const { marked } = (await import("marked")) as { marked: (md: string) => string };

      const bodyByRoute: Record<string, string> = {
        about: buildAboutBody(marked),
        legal: buildLegalBody(marked),
        passes: buildPassesBody(),
        "pool-stats-app": buildPoolStatsAppBody(),
      };

      for (const route of PUBLIC_ROUTES) {
        const metaHtml = injectRouteMeta(indexHtml, route);

        const staticBody = bodyByRoute[route.path] ?? "";
        const routeHtml = metaHtml.replace(
          /<div id="root"><\/div>/,
          `<div id="root">${staticBody}</div>`,
        );

        const routeDir = path.join(outDir, route.path);
        fs.mkdirSync(routeDir, { recursive: true });
        fs.writeFileSync(path.join(routeDir, "index.html"), routeHtml);
      }
    },
  };
}

export default defineConfig({
  base: basePath,
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    routeMetaPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
