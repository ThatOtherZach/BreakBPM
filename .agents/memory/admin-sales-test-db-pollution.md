---
name: admin-sales test assumes empty sale_events table
description: Pre-existing, unrelated-to-your-change failure mode in admin-sales.test.ts caused by real leftover rows in the shared dev DB, not test code or app regressions.
---

`GET /admin/sales` has no per-admin scoping — it's a global ledger, so
`admin-sales.test.ts` implicitly assumes `sale_events` is empty before it seeds
its own rows. The shared dev database can carry a few real leftover rows from
manual dev/testing sessions (e.g. `$0` comp "Day Pass" redemptions with normal
UUIDs and real dates, not obviously test fixtures) that no factory `cleanup()`
will ever remove, because `cleanup()` only deletes rows tied to `userId`s it
created in that process's `createdUserIds` array.

Symptom: `returns valued rows with own-column tax and full-range totals` and
the CSV export test fail with counts exactly `+N` over expected (e.g. expected
2 got 4), where N = the number of stray real rows currently sitting in
`sale_events`.

**Why:** the test's own logic and cleanup are correct in isolation; the
fragility is the implicit "table starts empty" assumption combined with a
shared, persistent dev DB that also accrues real usage data.

**How to apply:** before treating an admin-sales test failure as a regression
from your change, run `SELECT count(*) FROM sale_events` (or diff row IDs/dates
against what the test seeded) to check for pre-existing unrelated rows. If
found, this is pre-existing DB-state flakiness, not something your edit broke
— don't chase it as a regression. Fixing it for real would mean scoping the
test to only the events it created (e.g. filter by `id IN (...)` or by a
time window bracketing the test), which is a legitimate but separate
test-hygiene fix, not something to bundle into an unrelated task.
