---
name: Hall leaderboard player/game counts
description: The per-hall leaderboard response needs a taggedGames signal distinct from totalPlayers.
---

# Hall leaderboard: totalPlayers vs taggedGames

`HallLeaderboardResult.totalPlayers` means **ranked players** for the current
mode/window — it's the row count across pages, so it is `0` exactly when the
board is empty. It is NOT a count of everyone who has played at the hall.

**Decision:** the hall leaderboard response also carries `taggedGames` (any
activity ever tagged to the venue). Branch per-hall empty/activity UI on
`taggedGames`, not `totalPlayers`, to tell "no games tagged here yet" apart from
"games tagged but none qualify for the ranked board yet."

**Why:** `totalPlayers` couples to rows, so it can't distinguish those two empty
cases — relying on it gives dead UI. The global `/leaderboard` board has no
`taggedGames`; it's hall-only.
