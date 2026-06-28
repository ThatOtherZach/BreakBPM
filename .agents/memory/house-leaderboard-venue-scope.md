---
name: House Leaderboard (per-venue) scope & hall-tag race
description: How the per-hall leaderboard reuses the global ranking scoped by venueId, and the concurrency rule for tagging a game to a hall.
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

# Tagging a game to a hall must verify the guarded UPDATE actually wrote

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
