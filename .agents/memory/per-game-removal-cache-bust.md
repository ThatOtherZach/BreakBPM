---
name: Per-game removal cache bust needs a pre-tx participant snapshot
description: Why bustGameStatsCache(gameId) can't be called after a full-delete removal path, and what to do instead.
---

When a route removes a user from ONE game via `removeUserFromGameTx` (the shared
delete-or-anonymize primitive), busting stats cache for all participants must
use participant userIds **snapshotted inside the transaction, before removal** —
NOT a post-commit `bustGameStatsCache(gameId)` call.

**Why:** `bustGameStatsCache(gameId)` re-reads `game_participants` from the live
DB. The "deleted" outcome (no other real player remains) drops the game row and
its participants cascade away, so reading them after commit finds nothing and
co-players' personal-stats caches go stale until the (~1h) TTL.

**How to apply:** inside the tx, select all `game_participants.userId` for the
game first, run `removeUserFromGameTx`, return the userId list, then after the tx
`clearUserStatsCache(id)` for each (plus the caller) and `clearLeaderboardCache()`.
Mirrors the intent of `bustGameStatsCache` but survives the row deletion.
