# BreakBPM Architecture

High-level system design for contributors. For tier/feature access rules see [PERMISSIONS.md](../PERMISSIONS.md). For env flags see [ENV.md](./ENV.md).

## Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces, Node.js 24, TypeScript 5.9 |
| Frontend | React 19, Vite 7, Wouter routing |
| Auth | Clerk (isolated in `authClient.tsx`) |
| API | Express 5 |
| Database | PostgreSQL + Drizzle ORM |
| Validation | Zod (`zod/v4`), `drizzle-zod` |
| API codegen | Orval (OpenAPI → React Query hooks + Zod schemas) |
| Build | esbuild (CJS bundle for api-server) |

## Monorepo Layout

```
artifacts/breakbpm/     React frontend (Vite)
artifacts/api-server/   Express backend
lib/db/                 Drizzle schema (DB source of truth)
lib/api-spec/           OpenAPI 3.1 contract (API source of truth)
lib/api-zod/            Generated server Zod schemas
lib/api-client-react/   Generated React Query hooks
```

## Core Design Decisions

### Contract-first API

The OpenAPI spec (`lib/api-spec/openapi.yaml`) drives codegen for both server validation and client hooks. After any spec change:

```bash
pnpm --filter @workspace/api-spec run codegen
```

Never hand-write API types. Generated files are not auto-rebuilt.

### Pure game engine

`artifacts/breakbpm/src/lib/gameLogic.ts` is side-effect-free. `GameScreen.tsx` owns all state mutations. The server's `gameSummary.ts` mirrors BPM/accuracy math from `gameLogic.ts` — the two packages cannot import each other, so keep them in lockstep when scoring rules change.

### Dual persistence

In-progress games mirror to `localStorage` (survives refresh) and sync to the DB via `/games/activity` (cross-device resume). Recovery order: localStorage first, then server prompt.

### BPM is per-player

`calculatePlayerBPM(shotLog, playerName)` anchors at that player's first pocket. Shark steals use the `🦈 Shark` name and are excluded from human BPM.

### Tiered entitlements

`entitlement.ts` resolves every caller to exactly one tier: `public` / `account` / `pass`.

- **`pass` = one-time pass OR active subscription.** Either source grants the `pass` tier.
- **`hasActivePass` ≠ `tier`.** `hasActivePass` reflects one-time passes only. Gate "paid host" features on `tier === 'pass'`, never on `hasActivePass`.
- Lifetime-only perks: `entitlement.isAdmin || entitlement.activePass?.isLifetime`.

### Admins (effective Lifetime)

Emails in `BREAKBPM_ADMIN_EMAILS` synthesize an effective Lifetime pass. A real pass always wins over the synthetic one. Gate Lifetime perks on the entitlement, never raw `getActivePasses()`.

### Payments: crypto-first, card behind a flag

Purchasing is crypto (when enabled) + redeem codes. `cardPaymentsEnabled()` reads `BREAKBPM_CARD_PAYMENTS_ENABLED` (default OFF). Subscription *cancellation* stays on so legacy subs can stop renewing.

**Active paid path today:** redeem codes (Lucky Break, admin comps, card-store codes).

**Crypto catalog (when enabled):** flexible "Purchase Days of Access" (1–365 days), Lifetime, Lucky Break. Fixed Day/Month/Year pass *kinds* still exist for redeem codes but are not directly sold via crypto.

**30 Day Pass:** $4.99 / 30 days — available off-platform by card (`BREAKBPM_STORE_URL`, owner manually mints a redeem code) or via crypto at the 30-day slider point. Same price either way; card codes are emailed within 24h, crypto grants instantly. Internal DB kind is `twoweek` (legacy name).

### Lucky Break (provably-fair roll)

`luckyBreak.ts` is pure: SHA-256(global 30-day shot entropy + redemption id) → `[0,1)` → Lifetime if below disclosed probability, else 30-day floor. Odds are server-configured and disclosed via `/passes/plans`. Fairness copy must stay in lockstep across PassesScreen, LuckyBreakReveal, README, and ABOUT.md.

### Landing free-pass giveaway (one atomic claim)

`POST /passes/claim` mints + redeems a single-use code in one transaction. The reward is drawn server-side from two monthly pools (`free_pass_claim_pools`, sized by `BREAKBPM_FREE_PASS_MONTHLY_CAP`) via an oversell-proof guarded `UPDATE`. Three guards stop a double grant: the active-pass pre-check, the atomic pool decrement, and `UNIQUE(user_id)` on `free_pass_claims`. `claim`-issued redemptions book as $0 comps in the sales ledger — even when the drawn reward is a Lucky Break.

### Sales ledger (CAD, FX frozen at sale time)

Every completed sale appends a `sale_events` row. Pricing is USD; the ledger reports CAD for Canadian tax. Each row freezes a pre-transaction Bank of Canada USD→CAD rate. Fetch the rate pre-tx — never inside the transaction.

### Stats & leaderboards read distilled summaries

Stats, leaderboard, history, and profile endpoints read authoritative summaries written at game finalize (`gameSummary.ts` → `games.summary` + `game_participants.summary`), **not** raw `gameState.shotLog`. Bulk readers skip rows with absent/stale summaries and adjust denominators accordingly.

### Leaderboard scopes

All three boards share one ranking pipeline via a `LeaderboardScope` union:

| Scope | Filter |
|---|---|
| Global | (none) |
| Hall | `games.venueId` = tagged verified hall |
| City | `games.cityLocality` OR `games.venueId` in city's active halls |

A finished 1-on-1 8/9-ball game is tagged by its **host, on location, after it ends** via `/games/tag-hall` or `/games/tag-city`. Tagging is one-shot per game. City locality is the nearest verified hall's hand-entered label — no reverse-geocoding.

Hall boards expose a public 30-day window; 90-day and all-time require `pass` tier.

### One host, many viewers

The host device is the canonical scorekeeper. Joiners and spectators poll `/games/state` and render `JoinedGameScreen` — neither can score. Spectating via the official role requires a paid host (`tier === 'pass'`).

### DB auto-suspend friendly

Postgres bills compute-time and suspends when idle. No background timers touch the DB. Stale games finalize **lazily** on the next read/write. Poll cadences use tiered idle-backoff.

### @Mention linking (opt-in)

A paid host types `@username` in a non-host slot. On game start the server mints a pending `game_mentions` row. The recipient Accepts (creates their participant slot + stats) or Deletes on their Account page. Accepting after finalize requires summary re-distillation.

### SEO prerender pipeline

Build-time static HTML + JSON-LD for public routes via `vite.config.ts` `closeBundle`. Shared SEO copy lives in `src/lib/landingContent.ts`, imported by BOTH `vite.config.ts` (prerender + JSON-LD) and the React screens, so crawled HTML, on-page text, and JSON-LD stay in lockstep (also wired into `pageMeta.ts`, `sitemap.xml`, `llms.txt`, `Navbar.tsx`). Homepage body is written last with a guard script that strips injected content on non-`/` paths (catch-all rewrite safety). Hall pages are generated from a build-time Postgres query (raw `pg`, not `@workspace/db`) — skipped gracefully when `DATABASE_URL` is unavailable, so newly-minted halls only get a static page on the next deploy. Dynamic hall pages are served in the live sitemap at `/api/sitemap/venues.xml`, referenced from the static `<sitemapindex>` in `sitemap.xml`.

**Do not import `@workspace/*` packages into `vite.config.ts`** — the config loader cannot resolve them. Duplicate small constants locally instead.

### About/Manual labels are decoupled from URLs

The user-facing *label* "About" links to the marketing page (`/pool-stats-app`, keeping its SEO); the *label* "Manual" links to the guide (`/about`, the ABOUT.md page). URLs/canonicals/sitemap/JSON-LD are unchanged — only link text and the guide's title/meta wording differ. The Navbar nav-handler prop is `onManual` (→ `/about`); the "About" menu link navigates to `/pool-stats-app` directly. Keep the label→URL mapping in lockstep across Navbar (menu + hidden crawler anchors), prerender navs in `vite.config.ts`, `llms.txt`, `LegalScreen`, and `PoolStatsAppScreen`'s button.

### OBS overlay

`/watch/:name?obs=1` renders the live HUD as a chrome-free, transparent overlay (OBS Browser Source) — reuses spectator resolution + polling, no new route. Collapses to a themed `:(` face when there's nothing to show. Flags: `&log=1` (compact shot log), `&scale=<n>` (0.2–5).

### Invite & redeem intent handoff

Clerk `forceRedirectUrl` always lands on `/`. Per-link intent (redeem code, invite code, join code) is stashed in `localStorage` (30-min TTL) and resumed by a top-level effect scoped to `/`.

## Key Files

| Area | Path |
|---|---|
| Game engine | `artifacts/breakbpm/src/lib/gameLogic.ts` |
| Game summaries | `artifacts/api-server/src/lib/gameSummary.ts` |
| Auth seam | `artifacts/breakbpm/src/lib/authClient.tsx` |
| Entitlements | `artifacts/api-server/src/lib/entitlement.ts` |
| Pricing catalog | `artifacts/api-server/src/lib/pricing.ts` |
| Stats aggregation | `artifacts/api-server/src/lib/stats.ts` |
| DB schema | `lib/db/src/schema/` |
| API contract | `lib/api-spec/openapi.yaml` |
| Feature flags | `artifacts/api-server/src/lib/config.ts` |

## Development Commands

```bash
pnpm install
pnpm --filter @workspace/breakbpm run dev      # frontend
pnpm --filter @workspace/api-server run dev    # backend (no hot reload!)
pnpm run typecheck                             # canonical check
pnpm --filter @workspace/api-spec run codegen  # after spec changes
pnpm --filter @workspace/db run push            # dev schema push
```

The api-server has **no hot reload** — restart it after editing server source.