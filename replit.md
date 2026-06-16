# BreakBPM

A billiards scoring app that tracks shots, calculates per-player Balls Per Minute (BPM), and logs game history across 8-ball, 9-ball, and practice modes.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from the OpenAPI spec (run after any spec change)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string.
- Optional env (restart the api-server workflow after changing any):
  - `BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY` — Lucky Break Lifetime odds, decimal `[0,1]` (default `0.20`; invalid → warn + default).
  - `BREAKBPM_USD_CAD_FALLBACK_RATE` — USD→CAD rate used only when the Bank of Canada FX lookup is unreachable and nothing is cached (default ~1.37).
  - `BREAKBPM_PROMO_QR_URL` — URL for the splash-art QR easter egg (press-hold the splash 8-ball 3s); read per-request via `GET /config` (default `https://breakbpm.com`).
  - `BREAKBPM_STORE_URL` — off-platform card store (Squarespace) URL for the **14 Day Pass** ($5.99 card buy); read per-request via `GET /config`. Empty when unset → the PassesScreen card-store callout is hidden. Buyer pays by card on the store; owner manually mints a "14 Day Pass" admin redeem code and emails it.
  - `BREAKBPM_FREE_PASS_MONTHLY_CAP` — per-reward monthly stock for the free-pass giveaway (Lucky Break + Day each get a pool this size; default `15`; a new month = a new pool).
  - `BREAKBPM_ADMIN_EMAILS` — comma-separated admin allowlist (effective Lifetime + code minting).
  - `BREAKBPM_CARD_PAYMENTS_ENABLED` — toggles legacy Stripe card checkout (code default OFF; see Architecture).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite 7, Wouter routing
- Auth: Clerk (managed via Replit integration)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (OpenAPI spec → React Query hooks + Zod schemas)
- Build: esbuild (CJS bundle)
- Payments: crypto (on-chain) for one-time passes + redeem codes. Legacy Stripe card checkout / recurring subscriptions exist in code behind an env flag (currently off).

## Where things live

```
artifacts/
  breakbpm/           React frontend
    src/
      App.tsx           App shell — routing, game persistence, auth gating
      ABOUT.md          About-page copy (imported ?raw, rendered via marked)
      lib/
        gameLogic.ts    Pure game engine (8-ball, 9-ball, practice, Shark)
        authClient.tsx  Clerk seam — useAuth(), AuthProvider, SignedIn/Out
        pendingRedeem.ts  localStorage stash (30-min TTL) for /redeem/:code across the sign-up redirect
        landingContent.ts  Shared SEO copy (used by vite prerender + React screen)
        pageMeta.ts / version.ts / taglines.ts / forfeit.ts
      legal/            TERMS_OF_SERVICE.md + DATA_POLICY.md (rendered on /legal)
      components/
        SetupScreen / GameScreen / StatsScreen   Setup, live HUD + shot log, tiered stats
        JoinedGameScreen / WatchByNameScreen / ObsOverlay   View-only mirror, spectate-by-name, OBS overlay
        AccountScreen / PassesScreen / LuckyBreakReveal / RedeemScreen   Profile, pricing+redeem, roll reveal
        AboutScreen / LegalDisclosure / Navbar
  api-server/         Express backend
    src/
      index.ts          Server entry, port binding
      routes/           games, auth, passes, subscriptions, health, config
      lib/
        auth.ts         Clerk → local user upsert
        entitlement.ts  Resolves a user's Tier (public/account/pass)
        stats.ts        Tiered /stats aggregation (mirrors gameLogic.ts)
        luckyBreak.ts / luckyBreakEntropy.ts   Pure seeded-draw engine + entropy gather
        pricing.ts      Plan catalog, PASS_PRICES_CENTS, LUCKY_BREAK_INFO
        config.ts       Env flags (cardPaymentsEnabled default OFF, admin emails)
        fx.ts           Bank of Canada USD→CAD rate (for the CAD sales ledger)
        shareCode.ts / forfeit.ts

lib/
  db/src/schema/      Drizzle schema (source of truth for DB shape)
    users / games (+ game_participants) / passes / subscriptions / discountCodes / luckyBreak / mentions
    (passes = Day/Month/Year/Lifetime one-time; subscriptions = legacy recurring, sales off but cancel works)
  api-spec/openapi.yaml   OpenAPI 3.1 (source of truth for the API contract)
  api-zod/ + api-client-react/   Generated Zod schemas + React Query hooks
```

## Architecture decisions

- **Contract-first API**: the OpenAPI spec drives codegen for both server Zod schemas and client React Query hooks. Never hand-write API types — run codegen.
- **Auth seam in one file**: all `@clerk/react` imports are isolated to `authClient.tsx`; the app calls `useAuth()` from there. Swapping providers is one file.
- **Pure game engine**: `gameLogic.ts` is side-effect-free; `GameScreen.tsx` owns all state mutations. Keeps BPM/ball logic unit-testable.
- **Dual persistence**: in-progress games mirror to `localStorage` (refresh) and sync to the DB via `/games/activity` (cross-device resume). Recovery: localStorage first, then server prompt.
- **BPM is per-player**: `calculatePlayerBPM(shotLog, playerName)` anchors at that player's first pocket and measures to their latest. Shark steals use the `🦈 Shark` name and are excluded from human BPM.
- **Tiered entitlements**: `entitlement.ts` resolves a caller to `public` / `account` / `pass`. One-time passes (Day/Month/Year/Lifetime) live in `passes`; legacy recurring plans live in `subscriptions` (both set `tier:'pass'`). `hasActivePass` reflects one-time passes only — gate "paid host" features on `tier === 'pass'`. Buying Lifetime stops any active subscription renewing (in-tx, on every grant path).
- **Admins (effective Lifetime)**: emails in `BREAKBPM_ADMIN_EMAILS` are admins; `computeEntitlement` synthesizes an effective Lifetime pass (a real pass wins). Gate every Lifetime-only perk on the entitlement (`entitlement.isAdmin || entitlement.activePass?.isLifetime`), never raw `getActivePasses()`. Admins mint pass-granting redeem codes (`issuerKind:'admin'`); `discount_codes.issuerKind` isolates sources so admin/gift codes never collide.
- **Lucky Break (provably-fair roll)**: a `lucky_break` redeem-code kind that runs a server-side seeded draw on redeem. `luckyBreak.ts` is pure — SHA-256(entropy = last-30d global shot data + server `redemptionId`) → `[0,1)` → Lifetime if below the disclosed probability, else Monthly. Odds are server-configured and disclosed via `/passes/plans`, so displayed odds can't drift from rolled odds; shot data only *seeds* the outcome, it can't shift the threshold. Each roll snapshots its odds; the whole roll is one tx (one draw per code). **Fairness copy must stay in lockstep across PassesScreen, LuckyBreakReveal, ABOUT.md, and this file.**
- **Payments: crypto-first; card behind an env flag**: purchasing is crypto (on-chain) + redeem codes. `cardPaymentsEnabled()` reads `BREAKBPM_CARD_PAYMENTS_ENABLED` (default OFF). While off, card/subscription checkout+verify reject and `/passes/plans` reports `cardPaymentsEnabled:false` (subscription *cancel* stays on so existing subs can still stop). Endpoints + UI stay intact — flip the env to re-enable. Stripe creds come from the Replit Stripe connector, not env secrets.
- **Landing free-pass giveaway (one atomic claim)**: `POST /passes/claim` mints + redeems a single-use code in one tx. The reward is drawn server-side from two monthly pools (`free_pass_claim_pools`) via an oversell-proof guarded `UPDATE`. Three guards stop a double grant: the active-pass pre-check, the atomic pool decrement, and `UNIQUE(user_id)` on `free_pass_claims`. `claim`-issued redemptions book as $0 comps in the sales ledger (even a Lucky Break draw).
- **SEO/LLM landing (prerendered)**: `/pool-stats-app` shares copy from `src/lib/landingContent.ts`, imported by BOTH `vite.config.ts` (build-time prerender + JSON-LD) and the React screen, so crawled HTML, on-page text, and JSON-LD stay in lockstep. Also wired into `pageMeta.ts`, `sitemap.xml`, `llms.txt`, `Navbar.tsx`. **Pricing/offer/payment-method copy is duplicated across many surfaces (PassesScreen, pageMeta, vite.config prerender, index.html JSON-LD, llms.txt, ABOUT.md, legal docs) — change them together and grep the built `dist/` to verify.**
- **Sales ledger in CAD (FX frozen at sale time)**: every completed sale appends a `sale_events` row (admin report `GET /admin/sales`). Pricing is USD, but the ledger reports CAD for Canadian tax, so each row freezes a pre-tx Bank of Canada USD→CAD rate (`fx.ts`, never throws: last-good → env fallback → ~1.37), taxes the CAD gross, and keeps USD source + rate for audit. Fetch the rate pre-tx and pass it in — never inside the tx.
- **Tiered stats**: `GET /stats` is tier-gated (anon → global/24h; account → personal/24h; pass → selectable window + global toggle + `refresh`). Personal stats recompute from each game's `shotLog`; the per-player math in `stats.ts` mirrors `gameLogic.ts` — keep in lockstep. Also carries a cosmetic `chaosWinRecent` flag (rainbow AVG-BPM flourish) from the last 10 completed games, flowing through `/games/profile`.
- **One host, many viewers**: the host device is the canonical scorekeeper. Others get a view-only mirror by joining an open seat before the break (`/join/:code`) or spectating by name (`/watch/:name`). Both render `JoinedGameScreen` and poll `/games/state`; neither can score. Spectating requires a paid host.
- **DB-auto-suspend-friendly closure & polling**: Postgres bills compute-time and suspends when idle — no background timers/cron. Stale games (60-min inactivity / hard 60-min cap) finalize lazily on owner access (`sweepStaleGames`) or when a viewer reads the specific row (`finalizeGameIfStale`). Poll cadences are tiered, and the `/watch/:name` pre-live resolve poll uses idle-backoff so unattended tabs let the DB suspend. Unfinalized games are merely absent from stats/history, never corrupt.
- **OBS overlay**: `/watch/:name?obs=1` renders the live HUD as a chrome-free, transparent overlay (OBS Browser Source) — reuses spectator resolution + polling, no new route. Collapses to a themed `:(` face when there's nothing to show. Flags: `&log=1` (compact shot log), `&scale=<n>` (0.2–5).
- **@Mention to link players (opt-in)**: a paid host types `@username` in a non-host slot to link a registered player without a join code. `GET /mentions/resolve` resolves live; on start the server mints a pending `game_mentions` row (gated on `tier==='pass'`). Mentions count toward nothing until the recipient **Accepts** on their Account page (creates their real participant slot); **Delete** ignores/removes. Pending-invite cap is recipient-tier-based.
- **Venue coordinates are address-authoritative**: a venue's pin comes from geocoding its saved `address` server-side (`resolveVenueCoords` → Nominatim), not typed lat/lng. An admin bulk-repair endpoint re-geocodes all venues. **Never overwrite coordinates on geocode failure.**

## Product

- **Game modes**: 8-ball (2P/4P with teams, or 1P Shark), 9-ball, Practice. Shark = solo 8-ball vs an invisible honor-system AI (Normal steals on miss; Hard steals on miss + foul).
- **BPM tracking**: live per-player pace in the HUD; per-shot BPM stamped on pocketing entries. The HUD sublabel shows balls/group remaining.
- **Signed-in name lock**: the Player 1 name is prefilled + read-only when logged in (prevents stat pollution).
- **Join & spectate**: each game has a 5-char share code; others join an open seat before the break (view-only, guests allowed) or spectate by name. Joiners/spectators never score.
- **@Mention**: paid hosts link a registered friend by `@username` (no shared device needed); the friend gets an opt-in invite after the game finishes.
- **Stats & leaderboard**: `/stats` shows accuracy, pace, and ball/pattern breakdowns (retro CRT styling) with tier-gated windows. Recent Chaos winners get a rainbow AVG-BPM flourish. Plus a global BPM leaderboard.
- **Rematch / Resume**: signed-in players get a one-tap Rematch at game end (fresh game, same settings); logged-in users can resume an in-progress game cross-device.
- **Passes (crypto + redeem codes)**: free to play; sign in (free) to save stats. Four one-time passes — Day $1.99 / Month $4.99 (30d) / Year $14.99 (365d) / Lifetime $24.99 — bought on-chain with crypto or unlocked with a redeem code, none auto-renew. A fifth **14 Day Pass** ($5.99 / 14d, kind `twoweek`) is sold *off-platform by card* via the owner's Squarespace store (`BREAKBPM_STORE_URL`): the buyer pays by card there, then the owner manually mints a "14 Day Pass" admin redeem code (existing admin generator) and emails it (≤24h). It is deliberately worse value than the crypto Month pass to nudge buyers toward crypto, and is NOT crypto-buyable (absent from the crypto catalog). Passes unlock full history, stats windows, spectating, Find Players posting, @mention, leaderboard windows, and full export; Lifetime adds custom screen names. (Legacy Stripe card checkout + recurring subscriptions exist behind an env flag, currently off; existing subscriptions can still cancel.)
- **Lucky Break**: a $4.99 "roll the rack" sold via redeem code — a guaranteed ≥30-day pass with a disclosed ~20% chance of Lifetime, shown via a provably-fair seeded reveal (see Architecture).
- **Redeem share links**: `/redeem/:code` stashes the code (30-min TTL, survives the sign-up redirect) then auto-applies `/passes/redeem` once signed in, including the Lucky Break reveal.
- **Admin tools**: allowlisted admins mint pass-granting redeem codes (pick tier + max-uses) from the Account page and get every Lifetime perk without buying a pass.

## User preferences

- Keep all game logic pure and side-effect-free in `gameLogic.ts`.
- Shot log BPM stamps appear only on pocketing events (sink, win, lose-with-ball), never on miss/foul/safety/Shark entries.

## Gotchas

- Run codegen after any OpenAPI spec change — generated files are not auto-rebuilt.
- Don't `cd` or run `pnpm dev` at the workspace root — use `restart_workflow`. `PORT`/`BASE_PATH` are injected by the workflow config.
- The shared reverse proxy routes by path prefix (most-specific-first). All API calls go through `/api` — don't add Vite proxy configs.
- `pnpm run typecheck` is the canonical check; editor/LSP state can lag — trust the CLI.
- The api-server has NO hot reload — restart its workflow after editing server source.
- `calculatePlayerBPM` returns `null` (no pockets yet) or `0` (sub-ms elapsed); the HUD and shot log handle null gracefully.

## Pointers

- `pnpm-workspace` skill — workspace structure, TypeScript setup, package details
- DB schema: `lib/db/src/schema/`
- API contract: `lib/api-spec/openapi.yaml`
- Game engine: `artifacts/breakbpm/src/lib/gameLogic.ts`
- Auth seam: `artifacts/breakbpm/src/lib/authClient.tsx`
- Entitlement/tier resolution: `artifacts/api-server/src/lib/entitlement.ts`
- Stats aggregation: `artifacts/api-server/src/lib/stats.ts`
