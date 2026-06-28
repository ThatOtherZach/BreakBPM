---
name: Filter before rank when a cap is involved
description: Ranking/top-N endpoints must apply post-filters (active=true, etc.) inside the aggregate WHERE, not after ORDER BY/LIMIT.
---

# Apply qualifying filters BEFORE ORDER BY / LIMIT, never after

When an endpoint ranks rows by an aggregate and caps the result (top-N), any
"must-qualify" filter (e.g. `venues.active = true`) has to be part of the
aggregate's WHERE/JOIN so ranking and the LIMIT run over qualifying rows only.

**Why:** the tempting shortcut — rank everything, over-fetch a buffer (e.g.
LIMIT 20), then drop non-qualifying rows in app code and `slice(0,5)` — silently
returns too few (or wrong) rows when disqualified rows outrank qualifying ones.
If >buffer disqualified rows sit above the first qualifying one, valid rows are
never even fetched. There is no buffer size that is correct in general.

**How to apply:** prefer a single `innerJoin` of the entity table with the
qualifying predicate in WHERE, `GROUP BY <pk>`, `ORDER BY count DESC`, `LIMIT n`.
Grouping by the PK lets Postgres return all entity columns in the same query, so
you avoid both the buffer hack and a second lookup. This bit the
`GET /venues/popular` (top-5 active halls by finalized game count) endpoint —
caught only in code review, not by typecheck or the first tests.
