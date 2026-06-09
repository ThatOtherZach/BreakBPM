---
name: Shark Level = wins, computed in two lockstep queries
description: How the "Shark Level" stat is defined and the two SQL sites that must agree
---

Shark Level (`sharkLevel` / leaderboard `n`) is the player's ALL-TIME count of Shark-mode **wins**, not all Shark games played. A Shark game is flagged by a top-level `sharkAggression` key in the gameState JSONB; a win is the game's `winner` equal to the player's per-game `game_participants.displayName`.

**Win predicate (SQL):** `winner = displayName AND winner <> SHARK_PLAYER_NAME` ("Shark"). The second guard mirrors the in-loop convention in `computePersonalStats` (`r.winner === displayName && r.winner !== SHARK_PLAYER_NAME`) and matters only in the edge case where a human's screen name is literally "Shark" — without it, that user's losses would count as wins.

**Why:** screen names aren't reserved, so "Shark" is a possible (if pathological) human name; the profile and leaderboard must not disagree.

**How to apply:** the count is derived in TWO places in `stats.ts` — `computePersonalStats` (profile/Watch/Stats) and `computeLeaderboard` (leaderboard). Any change to the win definition must update BOTH, plus the matching field descriptions in `lib/api-spec/openapi.yaml` (StatsResult.sharkLevel and LeaderboardRow.sharkLevel). Count uses per-game `displayName` (not current screenName), so renames don't break historical attribution.
