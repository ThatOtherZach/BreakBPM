---
name: Bulk-stats summary-skip denominator
description: How computeGlobalStats/computePersonalStats must treat rows whose distilled summary is absent/stale, and which legacy quirk to preserve.
---

The bulk stats readers (`computeGlobalStats`, `computePersonalStats` in `artifacts/api-server/src/lib/stats.ts`) distill each finished game from its authoritative `summary` JSONB and SKIP any row whose summary is absent or a stale version (`readGameSummary`/`readParticipantSummary` → null). "Absent not corrupt": a skipped row must leave BOTH the numerator AND the denominator.

The rule: subtract ONLY genuinely summaryless rows from `gamesPlayed` (`core.gamesPlayed = rows.length - summaryless`), and guard every `/ gamesPlayed` division with `> 0`.

**Why:** legacy set `gamesPlayed = rows.length` and parsed the shotLog for every row, so no row was ever skipped. The new skip path can otherwise inflate `gamesPlayed`/`finishRate`/`avg*PerGame`/`winRate` while the row's counts are omitted — skewing every per-game average. This becomes live the moment `GAME_SUMMARY_VERSION` is bumped (a future task extends the summary): every old row reads as null until the one-time backfill reruns, so the readers must degrade by under-reporting (omit the row), never by mis-averaging.

**Preserve the legacy shark/8ball quirk:** discriminated-out games (`gameMode==="8ball"` skipping shark, or `"shark"` skipping non-shark) `continue` BEFORE the summary read and therefore STAY counted in `gamesPlayed` — because legacy assigned `gamesPlayed = rows.length` before the in-loop discrimination. Do NOT "fix" this to count-only-included-games: that changes legacy normal-case output for 8ball/shark modes, violating the "reproduce legacy EXACTLY" mandate. Only summaryless rows are excluded.

**How to apply:** when all summaries are present (steady state after backfill) `summaryless === 0` → `gamesPlayed === rows.length` → byte-identical to legacy. The contract is locked by `artifacts/api-server/src/routes/games-stats-summary.test.ts` (personal path: one finalized + one summaryless finished game → `gamesPlayed===1`, `avgShotsPerGame` un-diluted). The global path mirrors the identical `rows.length - summaryless` pattern.
