#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Seed the sale_events ledger from existing data so revenue history is complete
# from the moment the table rolls out. Idempotent (ON CONFLICT(provider_ref) DO
# NOTHING), so it is safe to run on every merge.
pnpm --filter @workspace/api-server run backfill:sale-events
# Distill every already-finalized game into its authoritative summary so the
# bulk stats/leaderboard/history read paths (which SKIP summary-less rows) stop
# hiding pre-summary games. Idempotent (recomputes + overwrites), safe per merge.
pnpm --filter @workspace/api-server run backfill:game-summaries
