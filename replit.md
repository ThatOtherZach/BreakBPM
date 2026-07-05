# BreakBPM

A billiards scoring app that tracks shots, calculates per-player Balls Per Minute (BPM), and logs game history across 8-ball, 9-ball, and practice modes.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages (canonical check)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from the OpenAPI spec (run after any spec change)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`. All optional `BREAKBPM_*` flags (pricing brackets, Lucky Break odds, admin allowlist, banned words, store URL, invite trial, feature toggles) are documented in **`docs/ENV.md`** — restart the api-server workflow after changing any.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite 7, Wouter routing · Auth: Clerk (Replit integration)
- API: Express 5 · DB: PostgreSQL + Drizzle ORM · Validation: Zod (`zod/v4`)
- API codegen: Orval (OpenAPI spec → React Query hooks + Zod schemas)
- Payments: crypto (on-chain) for one-time passes + redeem codes; legacy Stripe card/subscriptions behind an env flag (off)

## Where things live

```
artifacts/breakbpm/       React frontend
  src/App.tsx               App shell — routing, game persistence, auth gating
  src/lib/gameLogic.ts      Pure game engine (8-ball, 9-ball, practice, Shark)
  src/lib/authClient.tsx    Clerk seam — all @clerk/react imports isolated here
  src/lib/landingContent.ts Shared SEO copy (vite prerender + React screens)
  src/components/           Setup/Game/Stats screens, spectate, account, passes, navbar
artifacts/api-server/     Express backend
  src/routes/               games, auth, passes, subscriptions, crypto, admin, venues, config
  src/lib/                  entitlement.ts, stats.ts, gameSummary(.Writer).ts, luckyBreak.ts,
                            pricing.ts, config.ts, fx.ts, auth.ts
lib/db/src/schema/        Drizzle schema (source of truth for DB shape)
lib/api-spec/openapi.yaml OpenAPI 3.1 (source of truth for the API contract)
lib/api-zod/ + lib/api-client-react/  Generated Zod schemas + React Query hooks
```

## Architecture — key rules (details in `docs/ARCHITECTURE.md`)

- **Contract-first API**: OpenAPI spec drives codegen for server Zod schemas + client hooks. Never hand-write API types — run codegen.
- **Pure game engine**: `gameLogic.ts` is side-effect-free; `GameScreen.tsx` owns state mutations. Server `gameSummary.ts` mirrors its math — keep in lockstep.
- **Tiered entitlements**: `entitlement.ts` resolves `public`/`account`/`pass`. Gate paid features on `tier === 'pass'` (NOT `hasActivePass`); gate Lifetime perks on `entitlement.isAdmin || entitlement.activePass?.isLifetime`.
- **Stats read distilled summaries** written at finalize (`gameSummary.ts`), never raw `gameState.shotLog`.
- **DB auto-suspend friendly**: no background timers/cron touching the DB; stale games finalize lazily on access; polls use tiered idle-backoff.
- **Sales ledger in CAD**: every sale freezes a pre-tx Bank of Canada USD→CAD rate — fetch it before the transaction, never inside.
- **Venue coords are address-authoritative** (server geocodes); never overwrite coordinates on geocode failure.
- **Copy lockstep**: pricing/offer/payment-method copy is duplicated across PassesScreen, pageMeta, vite.config prerender, index.html JSON-LD, llms.txt, ABOUT.md, legal docs — change together, grep built `dist/` to verify. Same for Lucky Break fairness copy (PassesScreen, LuckyBreakReveal, ABOUT.md, docs).
- **Payments crypto-first**: card checkout is behind `BREAKBPM_CARD_PAYMENTS_ENABLED` (default OFF); Stripe creds come from the Replit Stripe connector, not env secrets.

## Product

Full feature reference in **`docs/PRODUCT.md`**. In one line: free scoring + BPM tracking; sign-in saves stats; passes (flexible crypto day-pass 1–365d, Lifetime $24.99, Lucky Break $4.99, card-store 30 Day Pass $4.99) unlock history/stats windows/spectating/@mention/leaderboard windows; per-hall + per-city local leaderboards; invite links grant a short free trial.

## User preferences

- Keep all game logic pure and side-effect-free in `gameLogic.ts`.
- Shot log BPM stamps appear only on pocketing events (sink, win, lose-with-ball), never on miss/foul/safety/Shark entries.

## Gotchas (full list in `docs/GOTCHAS.md`)

- Run codegen after any OpenAPI spec change — generated files are not auto-rebuilt.
- Don't `cd` or run `pnpm dev` at the workspace root — use `restart_workflow`. `PORT`/`BASE_PATH` are injected by the workflow config.
- The shared reverse proxy routes by path prefix (most-specific-first). All API calls go through `/api` — don't add Vite proxy configs.
- `pnpm run typecheck` is canonical; editor/LSP state can lag — trust the CLI.
- The api-server has NO hot reload — restart its workflow after editing server source.

## Docs index

- `docs/ARCHITECTURE.md` — full design decisions, key files, leaderboard scopes, SEO prerender pipeline
- `docs/ENV.md` — every env var incl. banned-words matching semantics
- `docs/PRODUCT.md` — feature-by-feature product reference incl. passes/pricing detail
- `docs/GOTCHAS.md` — categorized footguns (tooling, payments, game state, leaderboards, venues, UI, deploy)
- `PERMISSIONS.md` — tier/feature access matrix
- `pnpm-workspace` skill — workspace structure, TypeScript setup, package details
- DB schema: `lib/db/src/schema/` · API contract: `lib/api-spec/openapi.yaml`
