---
name: One-time data backfills don't reach production automatically
description: Why prod can silently miss a one-time backfill that dev has, and the two-part fix pattern.
---

# One-time data backfills don't reach production automatically

A one-time backfill script (e.g. `backfill:game-summaries`, `backfill:sale-events`)
will NOT run in production just because it exists or was run once in dev.

**Why:** `scripts/post-merge.sh` runs against the **dev** DB only (it executes on
task merge into the dev environment), and the autoscale deploy (`.replit`:
build = api-server build, run = `node dist/index.mjs`) runs **no** backfill at all.
So a new distill/backfill that read paths depend on can leave prod with 100% empty
data while dev looks perfect. Real incident: every prod finalized game had an empty
`{}` summary, and the bulk stats/history/leaderboard read paths deliberately SKIP
summary-less rows ("absent not corrupt") — so all users' stats showed blank in prod
while dev was fine.

**How to apply:** when a read path depends on a one-time backfill, ship BOTH:
1. **Lazy self-heal on the read path** — an idempotent, cheap-early-return helper
   (mirror `backfillHostParticipants` / `backfillUserGameSummaries` in
   `routes/games.ts`) that repairs the caller's own rows on first read, then bust
   only that caller's personal stats cache (`clearUserStatsCache`) when it repaired
   >0. Do NOT bust global/leaderboard caches per-user (stampede risk) — accept ≤1h
   TTL staleness.
2. **Add the backfill to `post-merge.sh`** so future rollouts converge — but
   remember this only fixes dev; prod still relies on the lazy self-heal (or a
   manual one-off run against the prod DB post-deploy).

Production DB is read-only via agent tools, so you cannot just run the backfill
against prod yourself — the lazy self-heal is what actually repairs prod data.
