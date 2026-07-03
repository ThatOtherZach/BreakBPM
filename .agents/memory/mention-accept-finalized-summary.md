---
name: Mention-accept summary recovery on finalized games
description: Accepting an @mention after a game finalized needs a manual summary re-distill or the accepted player's side is lost.
---

Per-slot game summaries are distilled ONCE at finalize (`writeFinalizedSummary`). An @mention accepted AFTER finalize creates the participant slot too late, so that slot has no summary and every bulk read path skips it ("absent, not corrupt") — the accepted player's stats/history/leaderboard for that game vanish.

Fix: the `/mentions/:id/accept` handler must, when the game is already finalized (`endedAt != null`), call `writeFinalizedSummary(gameId)` after the slot is created, then bust caches. It's idempotent (recomputes every slot), so it backfills the new slot without disturbing others.

**Second half of the same lesson (accuracy column):** the summary re-distill alone is NOT enough — the `game_participants.accuracy` snapshot column is only written at `/games/save` from client-supplied per-slot accuracies, so a post-finalize slot stays NULL there, and history/profile/mentions cards prefer that column → blank accuracy. Two-part fix: (1) read paths fall back to `summaryAccuracy(psum)` (derive round(made/attempts×100) from the participant summary) when the column is NULL — this lazily heals prod rows with no migration; (2) `writeFinalizedSummary` COALESCE-fills the column from the derived value (never clobbers a save-time snapshot; drizzle `.set` skips `undefined`).

**Why:** the writer runs at finalize before the slot exists; nothing re-runs it on late accept — and any per-slot column snapshotted only at save time has the same late-slot blind spot as the summary.

**How to apply:** any new post-finalize path that adds a participant slot (late join, late accept) must re-distill summaries + bust caches, mirroring the game-completion cache-bust. Distiller attributes STATS by `displayName` and HISTORY by `players[slotIndex].name`; the client pins a mentioned slot's player name to the canonical `screenName`, which equals the mention `display_name`, so attribution lines up.
