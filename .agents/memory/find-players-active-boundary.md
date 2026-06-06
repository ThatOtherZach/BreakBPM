---
name: Find Players active-post boundary
description: The "active post" time boundary on the Find Players (meetup) board and the set of places that must agree on it.
---

# Find Players active-post boundary

A Find Players post is "active" (listable, counted toward the max-5 limit, and
not purged) for the whole of its scheduled **UTC calendar date** — any time of
day — and any future date. The boundary is the **start of the current UTC day**
(`00:00:00.000Z`), NOT the exact `now` timestamp.

**Why:** Anchoring on exact `now` meant a post scheduled for *today* at an
earlier-than-now time was instantly treated as expired — rejected on create,
hidden from the list, uncounted, and purged. Users asked to be able to post
meetups for "today, anytime."

**How to apply:** The boundary must stay in lockstep across all of these (server
`findPlayers.ts` uses the `startOfUtcDay(now)` helper; the frontend mirrors it
with `setUTCHours(0,0,0,0)`):
1. create validation (reject `scheduledAt < startOfUtcDay(now)`)
2. list `activeFilter` (`>=`)
3. `countActivePosts` helper (`>=`)
4. the in-transaction active-count check on the create path (`>=`)
5. `purgeExpiredPosts` (delete `< startOfUtcDay(now)`)
6. frontend client-side validation in `FindPlayersScreen.submit`

If any one of these reverts to an exact-`now` comparison, same-day posts break
asymmetrically (e.g. created but immediately purged). The per-UTC-date duplicate
rule (`scheduledDateUtc`) and the one-year-out cap are independent of this.
