# SEO Strategy

## In scope
- Public homepage (`/`)
- Public informational pages (`/about`, `/legal`)
- Public monetization / feature-discovery path (`/passes`), even though it currently shows signed-out visitors a sign-in wall
- Shared SPA shell metadata that affects every public route
- Crawlability assets (`robots.txt`, `sitemap.xml`, favicon assets)
- AI-crawler readiness for public pages

## Out of scope
- Authenticated account surfaces (`/account`)
- Auth entry routes (`/sign-in/**`, `/sign-up/**`)
- Share / utility / capability URLs that are not intended as search landing pages (`/join/:code`, `/redeem/:code`, `/watch/:name`, OBS query variants)
- App-only experiences where SEO value is secondary (`/stats`, `/leaderboard`, `/find-players`) except where the shared shell causes site-wide SEO problems

## Target audience
- Recreational pool and billiards players who want a live score tracker
- Players looking for shot tracking, BPM stats, and shareable game scoring

## Primary keywords
- pool score tracker
- billiards scorekeeper
- 8-ball score tracker
- 9-ball score tracker
- billiards stats app
- pool BPM tracker

## Dismissed categories
- None yet.

## Scan notes
- BreakBPM is a client-rendered Vite SPA with no SSR, SSG, or prerender step for public routes.
- `/passes` should stay in scope for SEO scans because it is publicly routed and currently appears in the sitemap, even though its substantive pricing content is gated for signed-out visitors.
