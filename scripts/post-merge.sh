#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Seed the sale_events ledger from existing data so revenue history is complete
# from the moment the table rolls out. Idempotent (ON CONFLICT(provider_ref) DO
# NOTHING), so it is safe to run on every merge.
pnpm --filter @workspace/api-server run backfill:sale-events
