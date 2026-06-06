---
name: Stats cache must be busted on every game-completion path
description: Personal-stats cache is TTL'd; any path that sets games.endedAt must bust participant caches or live views stay stale up to the TTL.
---

resolveStats caches personal/24h snapshots for up to ~1h (STATS_CACHE_TTL_MS in stats.ts). Any code path that finalizes a game (sets `games.endedAt`) MUST call `clearUserStatsCache(userId)` for every participant, or live surfaces that read cached stats (notably the /watch/{name} profile StatsHero) keep serving stale numbers until the TTL expires — even when the client is polling.

**Why:** The watch profile "wasn't polling" bug was two-layered: the frontend query had no refetchInterval AND completion never invalidated the cache, so adding polling alone would still show stale hero numbers.

**How to apply:** There are FOUR completion paths to keep in lockstep:
- `/games/save` (normal finalize)
- `/games/abandon`
- `/games/leave` (all-left close)
- stale auto-finalization in `forfeit.ts` `finalizeStaleRow` (covers both lazy `sweepStaleGames` from many routes AND the periodic `sweepAllStaleGames`)
Routes use a `bustGameStatsCache(gameId)` helper (selects participant userIds, clears each). `finalizeStaleRow` does the bust inline, gated on `.returning()` length>0 so it only fires when the CAS update actually closed the row. Bust ALL participants (skip null/guest userIds), not just the host, so watching a joiner's profile is also fresh. forfeit.ts importing clearUserStatsCache from ./stats is safe — stats.ts does not import forfeit.ts (no cycle).
