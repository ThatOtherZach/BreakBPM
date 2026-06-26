---
name: Bulk-stats summary-skip denominator
description: How computeGlobalStats/computePersonalStats must treat rows whose distilled summary is absent/stale, and which legacy quirk to preserve.
---

The bulk stats readers (`computeGlobalStats`, `computePersonalStats` in `artifacts/api-server/src/lib/stats.ts`) distill each finished game from its authoritative `summary` JSONB and SKIP any row whose summary is absent or a stale version (`readGameSummary`/`readParticipantSummary` → null). "Absent not corrupt": a skipped row must leave BOTH the numerator AND the denominator.

The rule: subtract ONLY genuinely summaryless rows from `gamesPlayed` (`core.gamesPlayed = rows.length - summaryless`), and guard every `/ gamesPlayed` division with `> 0`.

**Why:** legacy set `gamesPlayed = rows.length` and parsed the shotLog for every row, so no row was ever skipped. The new skip path can otherwise inflate `gamesPlayed`/`finishRate`/`avg*PerGame`/`winRate` while the row's counts are omitted — skewing every per-game average. This becomes live the moment `GAME_SUMMARY_VERSION` is bumped (a future task extends the summary): every old row reads as null until the one-time backfill reruns, so the readers must degrade by under-reporting (omit the row), never by mis-averaging.

**Preserve the legacy shark/8ball quirk:** discriminated-out games (`gameMode==="8ball"` skipping shark, or `"shark"` skipping non-shark) `continue` BEFORE the summary read and therefore STAY counted in `gamesPlayed` — because legacy assigned `gamesPlayed = rows.length` before the in-loop discrimination. Do NOT "fix" this to count-only-included-games: that changes legacy normal-case output for 8ball/shark modes, violating the "reproduce legacy EXACTLY" mandate. Only summaryless rows are excluded.

**How to apply:** when all summaries are present (steady state after backfill) `summaryless === 0` → `gamesPlayed === rows.length` → byte-identical to legacy. The global path mirrors the identical `rows.length - summaryless` pattern.

**Self-heal vs skip — the two completed-game cases (don't conflate them):** the `/stats` route runs `backfillUserGameSummaries(user.id)` BEFORE compute, and it repairs ONLY rows where `summary = '{}'::jsonb` (the default of a finished-but-missed-summary game), then counts them. So a `{}`-summary completed game does NOT hit the compute-side summaryless skip — it gets a real `v:1` summary and is counted. The summaryless skip therefore only ever fires for STALE-VERSION rows (`v != GAME_SUMMARY_VERSION`), which the self-heal's `'{}'` filter does not match. The contract is locked by `artifacts/api-server/src/routes/games-stats-summary.test.ts` with TWO cases: (1) finalized + a `{}`-summary game → self-healed → `gamesPlayed===2`, `avgShotsPerGame===3`; (2) finalized + a stale-version game (use the `setStaleSummary` factory helper, writes `{v:0}` to game + participant rows) → skipped from BOTH numerator and denominator → `gamesPlayed===1`, `avgShotsPerGame===4`. **Pitfall:** a test that seeds a `{}`-summary game and expects it EXCLUDED is wrong post-self-heal — it will be counted.
