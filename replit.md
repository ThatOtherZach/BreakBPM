# BreakBPM

A billiards scoring app that tracks shots, calculates per-player Balls Per Minute (BPM), and logs game history across 8-ball, 9-ball, and practice modes.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env: `BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY` — Lucky Break Lifetime-upgrade odds as a decimal fraction in `[0,1]` (e.g. `0.2` = 20%). Defaults to `0.20`; invalid/out-of-range values log a warning and fall back to the default. Restart the api-server workflow after changing it.
- Optional env: `BREAKBPM_USD_CAD_FALLBACK_RATE` — USD→CAD rate (e.g. `1.37`) used only when the Bank of Canada FX lookup is unreachable and no last-good rate is cached. Invalid values fall back to a hardcoded default (~1.37). See the sales-ledger FX decision below.
- Optional env: `BREAKBPM_PROMO_QR_URL` — URL encoded into the splash-art QR easter egg (press-and-hold the splash 8-ball for 3s). Read fresh from the env on every `GET /config` request, so promo links can be swapped at runtime without rebuilding the static frontend. Defaults to `https://breakbpm.com` when unset/blank. Restart the api-server workflow after changing it.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite 7, Wouter for routing
- Auth: Clerk (managed via Replit integration)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec → React Query hooks + Zod schemas)
- Build: esbuild (CJS bundle)
- Payments: Stripe (one-time passes + recurring subscriptions, checkout/redeem codes)

## Where things live

```
artifacts/
  breakbpm/           React frontend
    src/
      App.tsx           App shell — routing, game persistence, auth gating
      ABOUT.md          About-page copy (imported as ?raw, rendered via marked)
      lib/
        gameLogic.ts    Pure game engine (8-ball, 9-ball, practice, Shark)
        authClient.tsx  Clerk seam — useAuth(), AuthProvider, SignedIn/Out
        forfeit.ts      Client-side forfeit/timeout constants (mirror server)
        taglines.ts     Random splash taglines
        version.ts      APP_VERSION constant
        pendingRedeem.ts  localStorage stash (30-min TTL) for a redeem code arriving via /redeem/:code, carried across the sign-up/sign-in redirect
      components/
        SetupScreen.tsx  Game setup — mode, player count, names, Shark aggression
        GameScreen.tsx   Active game HUD, shot logging, BPM display
        StatsScreen.tsx  Tiered shooting stats (retro CRT/PC-98 styling)
        JoinedGameScreen.tsx  View-only HUD for joiners + spectators (/join/:code); also renders the OBS overlay (?obs=1)
        WatchByNameScreen.tsx  Spectate by player name (/watch/:name); routes ?obs=1 into overlay mode
        ObsOverlay.tsx    OBS overlay primitives (transparent body class, scale clamp, `:(` idle face)
        AccountScreen.tsx  Profile, pass/subscription status, history
        PassesScreen.tsx   Lucky Break roll + (env-gated) card purchase + redeem
        LuckyBreakReveal.tsx  "Rolling the rack" reveal overlay (reuses .hud-chip)
        AboutScreen.tsx    Renders ABOUT.md
        RedeemScreen.tsx   Auto-applies a code from a /redeem/:code share link (stash → sign-up → redeem + reveal)
        Navbar.tsx
  api-server/         Express backend
    src/
      index.ts          Server entry, port binding
      routes/           games.ts, auth.ts, passes.ts, subscriptions.ts, health.ts, config.ts
      lib/
        auth.ts         Clerk → local user upsert
        stats.ts        Tiered /stats aggregation (personal vs global)
        entitlement.ts  Resolves a user's Tier (public/account/pass) from passes + subs
        subscriptions.ts  Recurring subscription lifecycle
        luckyBreak.ts   Pure seeded-draw engine (entropy + redemption id → outcome)
        luckyBreakEntropy.ts  Gathers last-30d global shot data as draw entropy
        pricing.ts      Plan catalog, PASS_PRICES_CENTS, LUCKY_BREAK_INFO
        config.ts       Env flags (cardPaymentsEnabled, default OFF)
        shareCode.ts    5-char share-code generation + normalization
        forfeit.ts      Server forfeit/timeout constants

lib/
  db/src/schema/      Drizzle schema (source of truth for DB shape)
    users.ts          users table (Clerk ID → screenName, onboarding)
    games.ts          games table (gameState JSONB, bpm_x10, last_activity_at)
                      + game_participants (per-player slots, displayName, stats window)
    passes.ts         passes table (Day/Month/Lifetime one-time entitlements)
    subscriptions.ts  subscriptions table (Monthly/Yearly recurring entitlements)
    discountCodes.ts  one-time/limited-use codes (incl. lucky_break code kind)
    luckyBreak.ts     lucky_break_rolls audit table (seed hash, window, outcome)
    mentions.ts       game_mentions table (host @-links a user to a slot; opt-in invite)
  api-spec/openapi.yaml   OpenAPI 3.1 (source of truth for API contract)
  api-zod/            Generated Zod schemas from spec
  api-client-react/   Generated React Query hooks from spec
```

## Architecture decisions

- **Contract-first API**: OpenAPI spec lives in `lib/api-spec/openapi.yaml`. Codegen produces both the server-side Zod schemas and the client-side React Query hooks. Never hand-write API types — run codegen instead.
- **Auth seam in one file**: All `@clerk/react` imports are isolated to `authClient.tsx`. The rest of the app calls `useAuth()` from that file. Swapping auth providers means rewriting one file only.
- **Pure game engine**: `gameLogic.ts` is side-effect-free. `GameScreen.tsx` owns all state mutations and calls into the engine for derivations. This makes the BPM logic and ball tracking unit-testable without rendering.
- **Dual persistence**: In-progress games are mirrored to `localStorage` (for tab-refresh) and synced to the DB via `/games/activity` (for cross-device resume). Recovery priority: localStorage first, then server prompt.
- **BPM is per-player**: `calculatePlayerBPM(shotLog, playerName)` anchors at that player's first pocketing entry and measures to their latest. Shark steals use the `🦈 Shark` player name and are excluded from human BPM automatically.
- **Tiered entitlements**: `entitlement.ts` resolves a caller into one of three `Tier`s — `public` (anonymous), `account` (signed in, no entitlement), `pass` (active pass OR subscription). One-time passes (Day/Month/Lifetime) live in `passes`; recurring plans (Monthly/Yearly) live in `subscriptions` as a separate source. `entitlement.hasActivePass` reflects one-time passes only; gate "paid host" features on `tier === 'pass'`. Buying Lifetime stops any active subscription from renewing (enforced in-tx on every grant path).
- **Admins (effective Lifetime + code minting)**: Emails in the `BREAKBPM_ADMIN_EMAILS` secret are admins (`isAdminEmail` in `config.ts`). `computeEntitlement` synthesizes an effective **Lifetime** `activePass` for an admin who has no real pass (so `tier:'pass'`, `hasActivePass:true`, `historyVisibleLimit:null`, `activePass.isLifetime:true`), and exposes `entitlement.isAdmin`. A REAL pass always takes precedence over the synthetic one. **Gate every Lifetime-only perk on the entitlement, never on raw `getActivePasses()`** — i.e. `entitlement.isAdmin || entitlement.activePass?.isLifetime` (currently: Day-Pass gifting in `giftCodes.ts`, and custom screen-name editing in `routes/auth.ts` + `AccountScreen.tsx`). Admins also mint pass-granting discount codes from the Account page via `adminCodes.ts` (`POST/GET /passes/admin/codes`, 403 for non-admins): admin picks a tier (day/month/year/lifetime) and a max-uses cap (or unlimited), codes are tagged `issuerKind:'admin'` and never expire. **Code-issuer isolation**: `discount_codes.issuerKind` (`'gift'|'admin'|null`) discriminates sources; all gift-code queries (cooldown/supersede/list) are scoped via `giftScope()` to `issuerKind IS NULL OR 'gift'` so admin codes never collide with the single-active-gift invariant (and vice versa).
- **Lucky Break (provably-fair roll)**: A `lucky_break` discount-code kind that, on redeem, runs a server-side draw instead of granting a fixed tier. `luckyBreak.ts` is a **pure** engine: it SHA-256-hashes the gathered entropy (last-30d global shot data, via `luckyBreakEntropy.ts`) together with the roll's server-assigned `redemptionId`, maps the hash to `[0,1)`, and returns Lifetime when the value is below the disclosed Lifetime probability else Monthly. The odds are **server-configured and disclosed** — `config.ts` `luckyBreakLifetimeProbability()` reads `BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY` (decimal in `[0,1]`, default `0.20`, invalid values warn + fall back), the call sites pass it into the pure engine (the engine stays env-free), and `pricing.ts` `luckyBreakInfo()` surfaces the *same* value to the client via `/passes/plans` so the disclosed odds can never drift from the rolled odds. Shot data only *seeds* (selects) the deterministic outcome, it cannot shift the threshold. Each roll snapshots its odds (`lifetimeProbabilityBps`) so changing the env var never rewrites history. The whole roll runs in-tx: gather entropy pre-tx → `computeLuckyBreakRoll` → `issuePassTx(month|lifetime)` → Lifetime stops subs → insert the redemption row (`id = redemptionId`) + a `lucky_break_rolls` audit row. The redemption id guarantees one draw per code (no re-roll). Reuse, don't re-implement: Lifetime perks (Day-Pass gifting) already include Lifetime via `giftCodes.ts` `ELIGIBLE_KINDS`.
- **Card payments behind an env flag**: `config.ts` `cardPaymentsEnabled()` reads `BREAKBPM_CARD_PAYMENTS_ENABLED` (code default **OFF**, but currently set **ON** via env). While off, `/passes/checkout`, `/passes/verify`, `/subscriptions/checkout`, `/subscriptions/verify` reject with `CARD_PAYMENTS_OFF_MESSAGE` (subscription *cancel* stays on so existing subs can still be stopped), and `/passes/plans` reports `cardPaymentsEnabled:false` so the frontend hides the card UI. Endpoints + UI are intact regardless — flip the env var to toggle. Stripe credentials come from the Replit Stripe connector (not env secrets). Restart the api-server workflow after changing the flag.
- **Sales ledger in CAD (FX frozen at sale time)**: Every completed sale appends a `sale_events` row (`recordSaleEventTx`) used by the admin sales report (`GET /admin/sales`, CSV + `AdminSalesPanel`). **All pricing is USD** (Stripe `currency=usd`, USDC≈USD, ETH priced off an ETH/USD feed; `PASS_PRICES_CENTS`/`LUCKY_BREAK_PRICE_CENTS`/`SUBSCRIPTION_PRICES_CENTS` are USD cents), but the ledger must report **true CAD** for Canadian tax. So each row freezes a USD→CAD conversion at sale time: `fx.ts` `getUsdToCadRate()` (today, 1h cache) / `getUsdToCadRateForDate(date)` (historical, 7-day trailing window, for backfill) hits the **Bank of Canada** Valet API (`FXUSDCAD`, free, CRA-accepted) and **never throws** — fallback chain is last-good → env `BREAKBPM_USD_CAD_FALLBACK_RATE` → hardcoded ~1.37. Rates are scaled ×1e6 (micros); `convertUsdToCad(usdCents, rateMicros)` is pure. `recordSaleEventTx` takes a required `fx: UsdCadRate`, keeps its `grossCents` input as the **USD source**, converts to CAD, **computes GST/PST on the CAD gross**, and stores both: CAD (`grossCents`/`gstCents`/`pstCents`/`netCents`) **and** audit (`sourceGrossCents`, `sourceCurrency='USD'`, `fxRateMicros`, `fxRateDate`, `fxSource`). **Fetch the rate pre-tx** (network) and pass it in — never fetch inside the tx. All call sites do this: `crypto.ts` (Lucky Break + fixed), `passes.ts` (redeem + verify), `stripeReconcile.ts` (purchase + renewal); the backfill script uses the per-row historical rate. Changing the env fallback never rewrites history (each row snapshots its own rate). Restart the api-server workflow after changing the fallback env.
- **Tiered stats**: `GET /stats` is gated by tier. Anonymous → global scope, 24h window. Signed-in (no pass) → personal scope, 24h. Pass holders → personal stats with selectable window (24h/30d/365d/all) and a global toggle, plus `refresh=true` to bypass the 1h server cache. Personal stats are recomputed from each game's `shotLog` (the denormalized `games.bpm`/`accuracy` columns are host-centric); the per-player math in `stats.ts` deliberately mirrors `gameLogic.ts` and must be kept in lockstep.
- **One host, many viewers**: The host device is the canonical scorekeeper. Others get a view-only mirror — either by **joining** an open seat before the break (`/join/:code`, occupies a slot, guests get a `guestToken`) or **spectating** any time (`/watch/:name` resolves a player's live game). Both render `JoinedGameScreen` and poll `/games/state`; neither can score or undo. Spectating requires the host to be a paid tier.
- **OBS overlay**: `/watch/:name?obs=1` renders the same live HUD as a chrome-free, transparent overlay for use as an OBS **Browser Source** (no new route, no extra backend — it reuses spectator resolution + polling). The page canvas goes transparent (a `obs-mode` class on `<html>`/`<body>`) so the video shows through behind the themed PC-98 panel; the overlay hugs its content (no navbar/back/status chrome) and stays live via the existing poll. Whenever there is nothing to show — no live game, host without an active paid pass, ended game, or an unresolved name — it collapses to a single themed `:(` face (never an error card or sign-in UI). Optional flags: `&log=1` adds a compact (≤6-line) newest-first shot log; `&scale=<n>` CSS-`transform: scale`s the whole overlay (clamped 0.2–5, default 1) so streamers get crisp resizing instead of OBS-side blur. Overlay primitives live in `ObsOverlay.tsx`; styles are the `.obs-*` / `body.obs-mode` rules in `index.css`. **OBS setup**: add a Browser Source, set the URL to the published `/watch/<name>?obs=1` (append `&log=1`/`&scale=1.5` as desired), leave "Shutdown source when not visible" off so it keeps polling, and size the source to the HUD (the panel is 480px wide at scale 1).

- **@Mention to link players (opt-in invites)**: A paid, signed-in host can type `@username` into a non-host SetupScreen slot to link a registered player without a join code. `GET /mentions/resolve` debounce-resolves the handle live (returns `eligible`/`found`/`atCap`/`screenName`; self never resolves) and the slot shows an inline badge (`🔗 name`, "Not Found :(", "Invite List Full :(", "Pass Required"). On start, resolved slots are sent as `mentions:[{slotIndex,screenName}]` in `StartGameInput`; the server (best-effort, outside the tx, gated on `entitlement.tier==='pass'`) mints a **pending** `game_mentions` row per recipient (case-insensitive screen-name match, skips self/dupes/over-cap, `onConflict`-safe). Mentions create **nothing** in the recipient's stats/history until they opt in. The recipient sees invites on their Account page (`GET /mentions`, finished games only): **Accept** (`POST /mentions/:id/accept`) creates their real `game_participants` slot (reusing the join flow's slot/displayName/stats-window conventions, `statsStartAt=game.startedAt`, busts stats cache) so the game counts; **Delete** (`DELETE /mentions/:id`) removes a pending invite (never counted) or, for an accepted one, anonymizes the caller's slot via the shared `removeUserFromGameTx` (host copy preserved) + clears their stats cache. Pending-invite cap is recipient-tier-based: `PENDING_INVITE_CAP_FREE=3` / `PENDING_INVITE_CAP_PAID=6`. The shot log attributes correctly because the host's slot name is pinned to the canonical `screenName` (so `shotLog.playerName === displayName`).

## Product

- **Game modes**: 8-ball (2P or 4P with team assignment, or 1P Shark mode), 9-ball, Practice (solo drills)
- **Shark mode**: Solo 8-ball vs an invisible AI opponent. Misses and fouls feed balls to the Shark. Aggression toggles between Normal (steals on miss) and Hard (steals on miss + foul). Ball removal is honor-system: when the Shark pockets, the player either lifts an easy-looking Shark ball off the real table or shoots one of the Shark's balls themselves, then taps it in the selector to keep the on-screen rack in sync.
- **BPM tracking**: Each player's live pace is shown in the HUD. Per-shot BPM is stamped on pocketing entries in the shot log so pace can be traced shot by shot.
- **HUD sublabel**: In 8-ball after teams are assigned, shows "N SOLIDS/STRIPES LEFT" (including the 8-ball in the count) or "8-BALL TO WIN" once the group is cleared. Other modes show "N BALLS LEFT".
- **Signed-in name lock**: When logged in, the Player 1 name field is prefilled with the user's screen name and made read-only, preventing stat pollution across all game modes.
- **@Mention to link players**: Paid hosts can type `@username` into another player's slot to link a registered friend without a join code — no need to be on the same device. The friend gets an opt-in invite on their Account page after the game finishes: Accept to count it toward their stats/history, or Delete to ignore it (it never counts). Accepted games can be removed later (the host's copy is unaffected).
- **Join & spectate**: Each game has a 5-char share code. Others can join an open seat before the break (view-only, guests allowed, can leave/forfeit) or spectate a player's live game by name. Joiners and spectators see the host's HUD, shot log, and BPM live but never score.
- **Stats page**: `/stats` shows shooting stats (results, accuracy, pace, ball/pattern breakdowns) with retro CRT styling. Windows and personal/global scope are unlocked by tier (see Tiered stats above).
- **Resume**: Logged-in users can resume an in-progress game from a different device via the server-side snapshot.
- **Lucky Break**: A $4.99 "roll the rack" unlock sold via redeem code (no card processor). Every roll is a guaranteed win — at minimum a 30-day Monthly Pass, with a disclosed chance (default 20%, server-tunable via `BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY`) of a Lifetime Pass. Redeeming plays a retro "rolling the rack" reveal (reusing the in-game ball chips) that lands on the won tier and shows the odds + a fair-play note. The draw is SEEDED (not biased) by the last 30 days of GLOBAL shot activity (all players) hashed with the roll's redemption id; the odds never move based on how anyone plays. See "Lucky Break (provably-fair roll)" under Architecture decisions.
- **History, passes & subscriptions**: Game history is stored per-user. Free users see limited history; Day/Month/Lifetime passes and Monthly/Yearly subscriptions unlock full access (redeemable via code; card checkout via Stripe is behind an env flag, currently off). Subscriptions renew until cancelled; access lasts through the paid period.
- **Redeem share links**: Any redeem code can be shared as a QR-friendly link `/redeem/:code`. Following it stashes the code (30-min TTL, survives the sign-up/sign-in redirect), sends a signed-out visitor to sign-up (sign-in also works), then auto-applies the existing `/passes/redeem` endpoint once authenticated — showing the normal result, including the Lucky Break "rolling the rack" reveal. Already-signed-in visitors get the code applied immediately. Expected refusals (expired/used/already-have-a-pass/invalid) show a friendly message; the stash is cleared on success and failure so a code never re-applies. No backend changes — the redeem endpoint and reveal are reused as-is.
- **Admin tools**: Allowlisted admins (via `BREAKBPM_ADMIN_EMAILS`) get an Account-page panel to mint pass-granting redeem codes — they pick the tier (Day/Month/Year/Lifetime) and how many times the code can be used (or unlimited), then share it. Admins are also treated as Lifetime-pass holders, so they get every Lifetime perk (Day-Pass gifting, custom screen names) without buying a pass.

## User preferences

- Keep all game logic pure and side-effect-free in `gameLogic.ts`.
- Shot log BPM stamps appear only on pocketing events (sink, win, lose-with-ball), never on miss/foul/safety/Shark entries.

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after any OpenAPI spec change — generated files are not auto-rebuilt.
- Do not `cd` or run `pnpm dev` at the workspace root — use `restart_workflow` or the workflow runner. `PORT` and `BASE_PATH` are injected by the workflow config.
- The shared reverse proxy routes by path prefix (most-specific-first). All API calls go through `/api`; do not add Vite proxy configs to work around this.
- `pnpm run typecheck` is the canonical check. Editor/LSP state can lag behind — always trust the CLI output.
- BPM null-guards: `calculatePlayerBPM` returns `null` (no pockets yet) or `0` (sub-millisecond elapsed). The HUD and shot log both handle null gracefully.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- DB schema: `lib/db/src/schema/`
- API contract: `lib/api-spec/openapi.yaml`
- Game engine: `artifacts/breakbpm/src/lib/gameLogic.ts`
- Auth seam: `artifacts/breakbpm/src/lib/authClient.tsx`
- Entitlement/tier resolution: `artifacts/api-server/src/lib/entitlement.ts`
- Stats aggregation: `artifacts/api-server/src/lib/stats.ts`
