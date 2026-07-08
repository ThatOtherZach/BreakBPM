---
name: Game-summary version bump rollout
description: How to add fields to distilled game summaries without breaking old rows or the prod rollout
---

Adding a field to the distilled game/participant summaries requires a coordinated version bump:

1. Bump `GAME_SUMMARY_VERSION`; keep `GAME_SUMMARY_MIN_COMPAT_VERSION` at the oldest still-readable version. Readers accept any `v` in `[MIN_COMPAT, CURRENT]` — new fields must be OPTIONAL on the types and stats accumulators must gate on the field being present (`!= null`), aggregating BOTH numerator and denominator only from rows that carry it, or mixed-version windows mis-average.
2. The lazy read-path self-heal (`backfillUserGameSummaries`) matches `COALESCE((summary->>'v')::int,0) < CURRENT` — this is the ONLY prod rollout path (one-time backfill scripts never run in prod; post-merge.sh is dev-only). It lifts `{}` AND older versions, and deliberately leaves FUTURE versions alone (rollback safety: an old writer must not clobber newer rows).

**Why:** first applied for the Defense stat (safety effectiveness) bump v1→v2; BPM/accuracy had to stay byte-identical, so re-distilling old rows only ADDS fields — never change existing math in the same bump.

**How to apply:** any time a new per-game or per-slot stat needs historical backfill from raw shotLog.
