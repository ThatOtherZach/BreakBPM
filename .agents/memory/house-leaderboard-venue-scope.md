---
name: House + City Leaderboard scope & hall/city-tag race
description: How per-hall and per-city leaderboards reuse the global ranking scoped by a LeaderboardScope union, the city geolocation fallback, and the guarded-UPDATE race rule for tagging a game.
---

# House Leaderboard = global ranking scoped by `games.venueId`

The per-hall ("House") leaderboard is the SAME composite-skill ranking as the
global `/leaderboard`, just filtered to games tagged to one Verified Hall via
`games.venueId`. A signed-in HOST tags a FINALIZED 8-ball/9-ball game to the
nearest active hall ("Add to Hall", which REPLACES the end-game Copy Link for
that case only). The House board's default 30d window is PUBLIC (signed-out
visitors can view recent standings + the venue card, and get a "sign up to track
scores" CTA under it — a growth on-ramp from a shared/QR link); longer windows
(90d/all) stay a pass perk, server-enforced. This mirrors the global board's
public-30d gate (`GET /leaderboard/hall` computes entitlement on a possibly-null
user and only 403s a non-pass caller for non-30d windows).

**Why:** lets players compete locally without a second ranking algorithm, and
turns a hall's board into a sign-up funnel for walk-in players.

**How to apply:**
- `venueId` must thread through the stats compute/resolve path AND the
  leaderboard cache key, or hall boards collide with the global board (same
  lockstep discipline as the other stats-cache notes).
- Client renders both boards from `LeaderboardScreen` with a `venueId?` prop:
  two generated hooks gated by `enabled` (global `!isHall`, hall
  `isHall && (isAuthenticated || window === "30d")` so anon gets the public 30d
  board), each needing an explicit queryKey. The header/standings/loading blocks
  render for `(isAuthenticated || isHall)`; the generic "sign in to view" panel
  is `!isHall` only; the sign-up CTA is `isHall && hallVenue && !isAuthenticated`.

# City Leaderboard = same ranking, scoped by a `LeaderboardScope` union

The stats scope is a union `{kind:'hall',venueId} | {kind:'city',locality,venueIds}`
(undefined = global). A CITY board rolls up BOTH games tagged directly to the
city (`games.cityLocality`) AND games tagged to any active hall in that city
(`venueIds`): filter is `or(eq(cityLocality,loc), inArray(venueId,venueIds))`.
Cache fragment is `global | hall:<id> | city:<loc>` — thread it through the
leaderboard cache key like the hall scope.

The CITY is a geolocation FALLBACK to hall-tagging, not a parallel feature: when
no verified hall is within the hall cap (`HALL_TAG_RADIUS_METERS`=300m), the host
may instead tag their city, and that city is **the nearest active verified hall's
hand-entered `locality`** within the metro cap (`CITY_TAG_RADIUS_METERS`=50_000m).

**Why:** deliberately NO reverse-geocoding — borrowing a real hall's verbatim
locality guarantees the tagged string always matches an existing City board, and
keeps "cities" restricted to those that actually have a verified hall.

**How to apply:**
- A game is hall XOR city tagged: `resolveHallTagEligibility` rejects a second
  tag of the other kind as `already_tagged`; both guarded UPDATEs require BOTH
  `venueId IS NULL` AND `cityLocality IS NULL`.
- `GET /leaderboard/city` 404s when no ACTIVE verified hall has that locality
  (it is then not a real City). venue create/patch/delete/repair must
  `clearLeaderboardCache()` because active/locality changes shift city scope.
- Client: `LeaderboardScreen` renders all three boards via `venueId?`/
  `cityLocality?` props; city route `/leaderboard/city/:locality` uses
  `encodeURIComponent`/`decodeURIComponent` (locality has a comma + space).

# Tagging a game to a hall (or city) must verify the guarded UPDATE actually wrote

`POST /games/tag-hall` does a guarded `UPDATE games SET venue_id=? WHERE id=?
AND venue_id IS NULL` so a concurrent tag can't overwrite an existing link. The
eligibility pre-check reads the row first, so there is a race window between
read and write. The guard alone is NOT enough: a lost race updates ZERO rows
but the handler would still return `success:true` for the wrong venue.

**Why:** two near-simultaneous tags (or a double-submit) could both pass
eligibility; only one wins the `venue_id IS NULL` guard.

**How to apply:** use `.returning()` and check the affected-row count. On zero
rows, re-read the row's current `venue_id`: idempotent `success:true` only if it
equals the requested venue, else `success:false, reason:"already_tagged"`. Same
"verify the write landed, don't trust the guard" rule as other atomic-grant
paths in this app.
