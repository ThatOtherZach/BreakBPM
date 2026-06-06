---
name: Find Players active-post boundary
description: The "active post" time boundary on the Find Players (meetup) board, its timezone frame, and the set of places that must agree on it.
---

# Find Players active-post boundary

Two frames are deliberately split: the **gate** ("is this today or later?") is in
the poster's **LOCAL** timezone; **storage + display** stay a UTC wall-clock
label ("shown identically to everyone", `formatSchedule` uses `getUTC*`, the
typed `dateStr+timeStr` is parsed with a trailing `Z`).

**Why local for the gate:** the native `<input type="date">` shows the user's
LOCAL calendar. A UTC-based `min`/validation made local "today" unselectable for
anyone behind UTC (Americas evening = already next-day UTC). So the picker `min`,
`maxDate`, the today/next30 filters, and the create check all use `localDateStr`
(local getters), and create validation is a plain string compare
`dateStr < localDateStr(new Date())`.

**Server grace:** because a single local date maps anywhere from the previous to
the next UTC day, the server lower bound is `activePostsSince(now)` =
`startOfUtcDay(now) − 24h` (one full UTC day of grace), so a legitimate
local-today post is never rejected/hidden/purged by UTC rollover. The client is
the real "not before local today" gate; the server bound is a lenient backstop.

**How to apply** — keep these in lockstep:
- Server `findPlayers.ts` `activePostsSince(now)` is used by: create validation
  (`<`), list `activeFilter` (`>=`), `countActivePosts` (`>=`), the in-tx
  active-count check (`>=`), and `purgeExpiredPosts` (delete `<`).
- Client `FindPlayersScreen.tsx`: `localDateStr` drives `today`/`maxDate`,
  `todayStr`/`next30Str` filters, and the submit-time past-date reject.
- `formatSchedule` and the `…T${timeStr}:00.000Z` parse stay UTC — do NOT switch
  display/storage to local; only the "today" gate is local.

If any server boundary reverts to `startOfUtcDay(now)` (no grace) or exact `now`,
behind-UTC local-today posts break (created then immediately purged / rejected).
The per-UTC-date duplicate rule (`scheduledDateUtc`) and the one-year-out cap are
independent of this boundary.
