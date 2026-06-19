---
name: Auto-earned profile theme — participation + dual resolver
description: How the auto-earned (no-card) profile theme is credited and the two resolvers that must stay in lockstep.
---

# Auto-earned profile theme: participation-based, 30-day window, two resolvers

The auto-earned profile background (free/account/expired-pass, and paid passes
with no redeem card) is computed from a player's recent completed games in
`userProfileBackground.ts`.

**Credit rule (durable decision):** a game counts toward a player's theme when
they were a *registered participant* in it — games they HOSTED **and** games
they JOINED — keyed on **their own per-game `game_participants.displayName`**
(`subjectDisplayName`), not the host's. Win-checks compare
`games.winner === subjectDisplayName`. Guests (null `userId`) never earn.

**Why:** a registered joiner who beats the host should get credit for the win,
not only the host. Hosting was the old (too narrow) basis.

**Recency window:** `EARN_WINDOW_MS` = 30 days (was 10). The "most recent
qualifying game within the window" freshness check gates all three buckets
(pool-player majority, shark 5-win, hustler 10-win).

**Farming is accepted, not policed:** the window resets, so a theme is only
"permanent" while a pass is active. Don't add anti-farm logic unless asked.

**Lockstep constraint:** there are TWO query paths that must classify games
identically:
- single-user `computeAutoEarnedVariant(userId)` → the `/games/profile` /watch
  hero path.
- batched `resolveUserProfileBackgrounds(args)` → the leaderboard path.
Both must use the participation-based `from(game_participants).innerJoin(games)`
filtered on `game_participants.userId`, select the participant's own displayName,
order newest-first, cap at 50 per user. Changing one without the other silently
drifts leaderboard colors from the real profile.

**How to apply:** when touching earn rules, edit both resolvers + the shared pure
`computeAutoEarnedVariantFromGames`, and keep doc windows in sync in
`profileBackground.ts`. Tests live in `autoEarn.test.ts` (pure, uses 29d-inside /
31d-outside to avoid exact-boundary flakiness), `userProfileBackground.test.ts`
(batched↔single lockstep), and `routes/games-profile.test.ts` (real route).
`seedGame` accepts a `winner` opt; `seedParticipant` adds a non-host slot.
