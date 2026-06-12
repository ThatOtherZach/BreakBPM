---
name: DB auto-suspend & compute cost
description: Why nothing may touch Postgres on a fixed timer/poll, and how BreakBPM finalizes stale games lazily + tiers polling to let the idle DB suspend.
---

The Postgres instance (Neon-style) bills compute-time and **auto-suspends when idle**.
Anything that touches the DB on a *fixed* schedule — a `setInterval` background job
or an unconditional per-poll query — keeps it awake 24/7 and defeats suspend, which is
the single biggest avoidable compute cost.

**Rules that follow from this:**
- No always-on background sweep/cron that queries the DB. (BreakBPM had a 5-min global
  stale-game sweep `setInterval` in the api-server entry — it was the main thing pinning
  the DB awake. Removed.)
- Lazy over eager: finalize stale in-progress games **on access**, not on a timer. Two
  triggers cover everything — the owner's next write/read (`sweepStaleGames`, on
  start/activity/save/resume/history/profile/resolve/join) and a viewer reading the
  specific game (the polled spectator paths). A pure single-row `isRowStale` +
  `finalizeGameIfStale` closes only the row being viewed instead of sweeping a whole
  user's games every poll.
- Poll only as hard as the audience needs, and back off when nobody's watching.

**Why:** removing the timer + trimming polls lets the DB suspend during idle stretches;
that's the compute-cost win. Active spectating must stay full-speed, so polling is
tiered by audience rather than globally slowed.

**How to apply:**
- Never reintroduce a DB-touching `setInterval`/cron "just to be safe." If a global
  background close is ever truly required, make it event-driven or accept the
  always-awake cost knowingly.
- **Tradeoff to remember:** with no global sweep, an abandoned hosted game (host never
  returns) with joiners or pending @mentions stays *open* until someone views it (its
  share code or the host's `/watch` page). It self-heals on any view. This is safe
  because every stats/history/leaderboard query filters `endedAt IS NOT NULL`, so an
  unfinalized game is merely **absent**, never corrupt.
- Tier live polls by who's looking; apply idle-backoff (reset on real user interaction:
  pointer/key/touch/scroll/focus) to *waiting/idle* states only — never to an active
  live feed. OBS overlays generate no interaction, so backoff lets them stop pinning the
  DB while a present human keeps the fast cadence.
