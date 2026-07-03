# SEO Strategy

## In scope
- Public homepage (`/`)
- Public marketing and discovery pages (`/pool-stats-app`, `/for-venues`)
- Public informational pages (`/about`, `/legal`)
- Public pricing / feature-discovery page (`/passes`)
- Public hall leaderboard pages (`/leaderboard/hall/:venueId`) because they are listed in the live sitemap and intended as search landing pages
- Shared metadata, structured data, and crawlability assets that affect those routes (`index.html`, `vite.config.ts`, `robots.txt`, `sitemap*.xml`, `llms.txt`, favicon assets)
- AI-crawler readiness for public pages

## Out of scope
- Authenticated account surfaces (`/account`)
- Auth entry routes (`/sign-in/**`, `/sign-up/**`)
- Share / utility / capability URLs that are not intended as search landing pages (`/join/:code`, `/redeem/:code`, `/watch/:name`, OBS query variants, `/claim`, `/invite/:code`)
- Auth-gated app surfaces where SEO value is secondary (`/stats`, global `/leaderboard`, `/find-players`, `/leaderboard/city/:locality`) except when shared shells or shared metadata create site-wide SEO problems

## Target audience
- Recreational pool and billiards players who want a live score tracker
- Players looking for shot tracking, BPM stats, and shareable game scoring
- Pool hall owners considering a free verified-hall listing

## Primary keywords
- pool score tracker
- billiards scorekeeper
- 8-ball score tracker
- 9-ball score tracker
- billiards stats app
- pool BPM tracker
- pool stats app
- pool hall leaderboard

## Dismissed categories
- None yet.

## Scan notes
- BreakBPM is now a hybrid static-prerendered SPA, not a pure SPA.
- `artifacts/breakbpm/vite.config.ts` prerenders `/about`, `/legal`, `/passes`, `/pool-stats-app`, and `/for-venues` with route-specific meta and static body HTML.
- The homepage (`/`) still serves the generic SPA shell with an empty `#root` in source, so its body copy and links remain JavaScript-dependent for non-rendering crawlers.
- Dynamic hall leaderboard pages are discoverable through `/api/sitemap/venues.xml`, but their venue-specific titles, descriptions, canonicals, and body content are still injected client-side in `LeaderboardScreen.tsx`.
- `robots.txt`, `sitemap.xml`, and `llms.txt` exist and should remain part of ongoing scans because they are now active SEO surfaces rather than missing assets.
