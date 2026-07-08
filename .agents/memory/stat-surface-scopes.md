---
name: DEF/ACC stat surface scopes
description: Why the same stat shows different numbers across account card, leaderboard, and Stats screen — and the shark-board DEF rule.
---

# Stat surfaces intentionally use different scopes

- **Leaderboard/standing ACC** = average accuracy over a player's best-N ranked games (window, qualifying 1v1 only). **Stats screen ACC** = pooled made/attempts over every game in the window (incl. Shark). These can differ by 20+ points for the same player — that is by design, not corruption.
- **Account identity card** reads BOTH its ACC and DEF chips from `globalStanding` (the all-time 8-ball board row passed through `/auth/me`), so the card is coherent with the leaderboard. Do NOT switch a chip back to `account.defense*` (all-time pooled personal) — that mixed-scope card was reported as a bug ("weird DEF/ACC").
- **Shark-mode boards never show DEF**: safeties vs the Shark are never "held", so DEF is 0% for everyone. `LeaderboardRowCard` has a `hideDefense` prop; the main board passes `hideDefense={mode === "shark"}` (covers global/hall/city — one component). New LeaderboardRow consumers rendering shark rows must gate the same way.
- **Presence flicker is expected**: DEF displays hide when the window has zero safeties (`defenseRate == null`), so rolling windows make DEF appear/disappear through the day — legitimate, per user decision ("leave it").

**Why:** A prod "weird stats" report (July 2026) was fully diagnosed as scope mixing + null-gating, with zero data corruption — don't re-investigate the DB first for similar reports; check surface scopes.
