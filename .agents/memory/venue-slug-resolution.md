---
name: Venue slug resolution (per-hall leaderboard URLs)
description: How /leaderboard/hall resolves the :venueId param (slug OR legacy id) and why id must win on collision.
---

The per-hall leaderboard route `/leaderboard/hall/:venueId` accepts EITHER the
readable `venues.slug` (new links) OR the raw 32-char id (legacy / un-backfilled
links). Slugs are minted from the venue name (pure `venueSlug.ts` → DB
mint/self-heal in `venueSlugStore.ts`), backfilled via post-merge, and
lazily self-healed when a slug-less hall is read.

**Rule:** when resolving the param, an exact `id` match must take precedence over
a `slug` match. Do NOT use `where(or(eq(id), eq(slug))).limit(1)` — that is
nondeterministic.

**Why:** id (lowercase hex) and slug (`[a-z0-9-]`) charsets overlap, so in the
pathological case one venue's id equals another's slug, `OR ... LIMIT 1` could
return the wrong row and break the "legacy id links must keep working" guarantee.

**How to apply:** fetch all rows matching either, then
`rows.find(v => v.id === param) ?? rows[0]`.
