---
name: History card subject-relative outcome
description: Why game-history WIN/LOSS must be recomputed per-subject, and how to locate the subject safely.
---
The stored `games.outcome` / `games.winner` are NOT viewer-aware: `outcome='won'` only means "a human won" (vs the Shark). A 2P/4P game the account owner *lost* is still stored as `won`. Any per-user history/profile card must recompute WIN/LOSS relative to the subject from `gameState.players` (which carries `team` for 4P).

**Why:** History cards once showed "WIN" + the winner's name even when the profiled player lost.

**How to apply:**
- Locate the subject by their `game_participants.slotIndex`, NOT by matching current screenName against `gameState.players[].name`. `gameState.players` is ordered by slot (players[i] === slot i), so slot lookup is rename-proof and survives 4P duplicate display names. Name match is a fallback only when slot is unknown (legacy rows).
- Win = subject's team === winner's team (4P) else winner === subject's in-game name. Preserve `forfeit` as DNF; Shark games have no opponent (card renders its own Shark label).
- Both `/games/history` and `/games/profile` build this; the `opponent` field is part of `GameHistoryEntry` in the OpenAPI spec.

## Per-participant pace in history (BPM + sunk count)
`games.bpm` / `games.sunkBallsCount` are the HOST's, but BPM is per-player. `/games/history` and the `/watch/:name` profile recompute each subject's pace via `resolveParticipantPace`: filter the shot log by the subject's SLOT player name (`gameState.players[slot].name` — the same key the host uses to attribute per-slot accuracy at save), bounded by `statsStartAt`; mirror `calculatePlayerBPM` (anchor at first pocket → latest own entry; null = no pockets, 0 = sub-ms).

**Why:** Joiners were seeing the host's pace/ball count in their own history.

**How to apply:** Filter by slot player name, NOT `game_participants.displayName` (a joiner's screenName often differs from the host-typed slot name; `stats.ts` filters by displayName, which is a separate latent issue). Fall back to row-level host values ONLY when the subject is the host and no own shots are attributable (legacy / name mismatch); a joiner with no attributable shots correctly shows none/0.
