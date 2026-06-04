---
name: Delete-my-data scope
description: How "delete all my game data" treats hosted vs joined games, and why joined-game shots are unlinked not scrubbed.
---

# Delete-my-data scope (DELETE /games/data)

Deleting a user's game data deletes the games they **hosted** (their shot logs
live in that game's `gameState` JSONB, so the row delete removes the shots; the
FK cascade clears participant slots on those games). For games they **joined**
(hosted by someone else), it only removes the user's `game_participants` slot —
it does NOT rewrite the host's `gameState.shotLog` to scrub the joiner's shot
entries.

**Why:** Joined games are owned by the host (the canonical scorekeeper).
Mutating another user's `gameState` to strip a participant's shots would corrupt
the host's game record — BPM, accuracy, rack/sunk-ball integrity all derive from
the full shotLog. After unlinking the participation, the data is gone from the
deleting user's history, stats, and export (all of which query by participation),
so from their perspective it's fully deleted; the only physical remnant lives in
the host's private record.

**How to apply:** Keep delete = "delete hosted games + unlink joined
participations". If a future task truly needs to purge a user's shots from
others' hosted games, treat it as a deliberate cross-user destructive change and
confirm with the user first — don't silently rewrite host gameState.

Related: after delete, call `clearUserStatsCache(userId)` (stats.ts) so the
1-hour personal-stats cache doesn't serve stale numbers to free/account-tier
users who can't force a refresh.
