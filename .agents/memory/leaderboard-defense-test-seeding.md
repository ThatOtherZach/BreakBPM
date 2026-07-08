---
name: Leaderboard defense-test seeding
description: How to seed safeties in leaderboard tests without disturbing BPM/accuracy, and what counts as a successful safety.
---

Rule: when testing the leaderboard defense bonus, place safety shot-log entries BEFORE the first sink (at the base timestamp). BPM stamps only exist on pocketing events, so safeties placed there leave BPM and accuracy identical between fixtures — letting a test isolate the defense factor as the only score difference.

**Why:** BPM = balls per elapsed pocketing time; inserting safeties between/after sinks shifts elapsed time and silently changes the base score, making "defender outranks identical non-defender" assertions flaky or wrong.

**How to apply:** in api-server leaderboard tests, seed the control and defender players with identical sink sequences; add the defender's safety entries at the log start. A safety counts as "successful" only when the NEXT entry is a different player's non-pocketing shot. Also: LeaderboardRow test fixtures must include every required schema field — tests are excluded from tsc, so a missing field surfaces as a runtime Zod 500, not a type error.
