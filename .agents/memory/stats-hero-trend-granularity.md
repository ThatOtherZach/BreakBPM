---
name: Stats hero trend granularity
description: Why the Stats hero trend graph buckets by period instead of plotting the last N games.
---

The hero trend sparkline (`StatsHero`) is fed by `StatsCore.trend`, which `buildWindowedTrend()` in `stats.ts` builds at a granularity that follows the selected window: per-game for 24h (last 24), per-UTC-day average for 30d, per-UTC-month average for 365d and all-time.

**Why:** plotting "the last 24 games" made every window wider than ~your last 24 games look identical (the newest 24 games fall inside 30d/1y/all alike), so the window selector appeared to do nothing. Bucketing by period makes the line genuinely reshape per window and naturally bounds the point count regardless of data volume — the user explicitly chose this over a higher game cap.

**How to apply:** both `computePersonalStats` and `computeGlobalStats` collect `RawTrendPoint{endedAt,bpm,accuracy}` (needs `endedAt` in the row select) and call `buildWindowedTrend(trend, window)`. Each bucket averages BPM and accuracy independently, skipping the null side. The `StatsHero` graph label unit (GAMES/DAYS/MONTHS) is derived from `appliedWindow` and must stay in sync with these granularity tiers. The watch profile always passes 24h, so it stays per-game.
