---
name: City leaderboard slug URLs
description: How /leaderboard/city/:locality resolves slug vs exact locality, and the client/server slugify lockstep.
---

City board URLs use slug form (`/leaderboard/city/vancouver-canada`); legacy encoded localities (`Vancouver%2C%20Canada`) still work.

- Server (`GET /leaderboard/city`): **exact locality match on active venues always wins first**; only when zero venues match does it slugify the param and compare against slugified distinct localities (alphabetically ordered so collisions resolve deterministically). Response `city.locality` is always the real locality.
- Client `artifacts/breakbpm/src/lib/citySlug.ts` `citySlug()` must stay in lockstep with server `slugifyText()` in `lib/venueSlug.ts` — if they drift, generated links 404.
- All city links go through `cityBoardPath()`; LeaderboardScreen replace-navigates legacy URLs to slug form once the server confirms the city, and prettifies a slug-looking param for the signed-out hero (city data is auth-gated).

**Why:** URLs were ugly percent-encoded; slugs can't be reverse-parsed (comma placement lost), so the server must resolve slug → real locality, and exact match must win so one city's locality can't be shadowed by another's slug.
**How to apply:** any new city-link producer must use `cityBoardPath()`; any slugify change must touch both copies.
