---
name: Delete-my-data scope
description: How "delete all my game data" decides per-game between full delete and anonymize-to-Mr.-X.
---

# Delete-my-data scope (DELETE /games/data)

Deleting a user's game data is per-game, not "delete hosted + unlink joined".
For every game the user touches (host OR participant), count the OTHER **real
players** = participant slots with a non-null `userId` that aren't the caller.
Guests (`userId` null) and already-anonymized slots do NOT count.

- **No other real player remains → delete the whole game** (`DELETE FROM games`).
  The shot log lives in `gameState`, so it goes with the row; the FK cascade
  clears participant rows. Covers solo games, un-joined games, and the
  "both players eventually delete" case (second deleter finds none left).
- **Other real players remain → anonymize only the caller**: replace their name
  (their `game_participants.displayName`) everywhere — `gameState.players[].name`,
  every `gameState.shotLog[].playerName`, `gameState.winner`, AND the
  denormalized `games.winner` column — with a collision-safe "🕴️ Mr. X"
  (append " 2", " 3"… if that name already exists in the game). Then sever the
  link: set the caller's participant row `userId = null`, `displayName = Mr. X`.

**Why never remove shot entries:** BPM, accuracy, and rack/sunk-ball integrity
all derive from the full ordered shot log (gameLogic.ts + stats.ts mirror each
other). Renaming is consistent and preserves every remaining player's math;
deleting entries would corrupt their game.

**Why no schema change:** history/stats/export all key off
`game_participants.userId`, so nulling the caller's slot removes the game from
their view even though `games.userId` (NOT NULL) still points at them on a
hosted-and-anonymized game. That dangling `games.userId` is inert for ended
games — `backfillHostParticipants` only matches games with ZERO participant
rows, and an anonymized game still has rows, so it won't re-create a slot.

**How to apply:** Whole flow runs in one `db.transaction`. Afterward call
`clearUserStatsCache(userId)` (stats.ts) so the 1-hour personal-stats cache
doesn't serve stale numbers to free/account-tier users who can't force a
refresh. Response shape is `{ deleted, deletedGames, anonymizedGames }` — the
Stats-page client doesn't read these fields, so changing them is client-safe.
