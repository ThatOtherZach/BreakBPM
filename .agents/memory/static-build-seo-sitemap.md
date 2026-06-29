---
name: Static-build SEO — dynamic sitemap + sitemap index
description: How to make DB-created pages (e.g. per-hall leaderboards) crawlable when the frontend is a static Vite build with no SSR.
---

# Static-build SEO for DB-created pages

BreakBPM's frontend (`artifacts/breakbpm`) ships as a **pure static Vite build**
(`serve="static"`, catch-all `/* → /index.html`); the Express api-server only
owns `/api`. There is **no SSR** and the build-time prerender plugin in
`vite.config.ts` can only cover a fixed `PUBLIC_ROUTES` list — it cannot enumerate
rows that admins create *after* deploy.

**Rule:** any SEO surface whose set of URLs is database-driven (e.g. hall pages
`/leaderboard/hall/:slug`) must be served from the **api-server**, not baked into
the static build. The pattern used:

- A live XML endpoint on the api-server (e.g. `GET /api/sitemap/venues.xml`)
  queries the rows and emits a `<urlset>`. Public/unauth (it only exposes data
  already public on the pages themselves). It is intentionally **outside the
  OpenAPI/codegen contract** — crawler-facing XML, not a typed client JSON hook.
- The static `public/sitemap.xml` becomes a `<sitemapindex>` referencing the
  static-pages sitemap (`sitemap-pages.xml`) **plus** the api-served sitemap, both
  same-origin via the shared proxy. `robots.txt` keeps pointing at `/sitemap.xml`.

**Per-page meta is client-side only.** `usePageMeta` (`src/lib/pageMeta.ts`,
nullable) updates `<title>`/description/canonical/OG at runtime. JS-rendering
crawlers (Google) pick this up, but the **initial HTML stays generic** — so
non-JS consumers (social OG scrapers, some backlink tools) see the home meta.
Fully universal crawlability / correct social previews for these pages would need
SSR/prerender/meta-injection for the dynamic routes (not yet done).

**Why:** static hosting can't list post-deploy rows and can't render per-row meta;
the api-server is the always-on component that can.

**How to apply:** new DB-driven SEO pages → add their URLs to an api-served
sitemap referenced by the sitemap index, set a slug canonical via `usePageMeta`,
and keep backlinks `rel="noopener"` (never `nofollow`) so they pass link value.
Hardcode `https://breakbpm.com` to match the existing canonical/meta convention.
