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
  - `BREAKBPM_DAY_PASS_*` — flexible crypto **Purchase Days of Access** pricing (marginal brackets — see `config.ts` `dayPassPricing()` / `pricing.ts` `computeDayPassPriceCents`): `_FIRST_DAY_CENTS` (first-day flat fee, default `199`), `_MID_RATE_CENTS` (per-day add for days 2–threshold, default `10`), `_MID_THRESHOLD` (day the cheaper bracket starts, default `30`), `_LONG_RATE_CENTS` (per-day add beyond the threshold, default `3`), `_MAX_DAYS` (longest run, default `365`). `minDays` is fixed at 1; blank/invalid → warn + default. The params ship to the client via `GET /passes/plans` so the slider estimate and the server-frozen quote always use the same numbers.
  - `BREAKBPM_INVITE_TRIAL_HOURS` — length (in hours) of the free trial pass granted to a NEW user who signs up via an invite link (`/invite/{code}`); whole number, min 1 (default `6`; blank/invalid → warn + default). Shipped to the client as `InviteCodeResult.trialLabel` (e.g. "6-hour") so the AccountScreen invite copy never drifts.
  - `BREAKBPM_ADMIN_EMAILS` — comma-separated admin allowlist (effective Lifetime + code minting).
  - `BREAKBPM_BANNED_WORDS` — comma-separated blocklist for user-supplied free text. Case-insensitive matching (`wordFilter.ts`) combines three rules so glued/compound evasions are caught without flagging the app's vocabulary: (1) **short** entries (≤3 chars, e.g. `ass`/`jew`/`sex`) match only at **letter boundaries** — "ass"/"45ass56"/"ass!!" caught, but "passes"/"class"/"jewelry"/"Sussex"/"bass" spared (3-letter fragments are too common inside real words to match as substrings); (2) **long** entries (≥4 chars, e.g. `cunt`/`fuck`/`pussy`) match **anywhere**, so a banned word glued onto other text ("cuntycounty", "fuckyou") is caught — *trade-off*: a long entry also flags real words containing it (banning `cock` would flag "cocktail"/"peacock"), so tune the list accordingly; (3) a whole letter-run composed **entirely** of banned words ("pussyass" = pussy+ass) is swapped wholesale, catching concatenations while sparing "assassin"/"bassist" (leftover letters mean not fully composed). Inflections like "shitty" still need explicit entries. Empty/unset → no filtering. **Three surfaces**: HUD ad copy is *cleaned* server-side (each blocked word swapped for a random friendly emoji, never rejected — `cleanBannedWords`); in-game player names are *cleaned* client-side at the SetupScreen input (`sanitizePlayerName` in `breakbpm/src/lib/wordFilter.ts`, list delivered via `GET /config`; on top of the blocklist it strips invisible/control/bidi chars, emoji-swaps URLs/markup, and caps the name at 35 chars); custom screen names are *rejected* with "choose another name" (emoji can't live in the public `/watch/{name}` URL handle — `findBannedWord`).
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
      ABOUT.md          Manual-page copy (the /about guide; imported ?raw, rendered via marked)
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
        stats.ts        Tiered /stats + leaderboard aggregation (reads distilled summaries, not shotLog)
        gameSummary.ts  Pure shot-log distiller — buildGameSummary + readers + GAME_SUMMARY_VERSION (mirrors gameLogic.ts)
        gameSummaryWriter.ts  Writes the authoritative summary at every finalize path (idempotent)
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
- **SEO/LLM landing (prerendered)**: `/pool-stats-app` shares copy from `src/lib/landingContent.ts`, imported by BOTH `vite.config.ts` (build-time prerender + JSON-LD) and the React screen, so crawled HTML, on-page text, and JSON-LD stay in lockstep. Also wired into `pageMeta.ts`, `sitemap.xml`, `llms.txt`, `Navbar.tsx`.
- **About/Manual labels are decoupled from URLs**: the user-facing *label* "About" links to the marketing page (`/pool-stats-app`, keeping all its SEO), while the *label* "Manual" links to the guide (`/about`, the ABOUT.md page). URLs/canonicals/sitemap/JSON-LD are unchanged — only link text + the guide's title/meta wording changed. The Navbar nav-handler prop is `onManual` (→`/about`); the "About" menu link navigates to `/pool-stats-app` directly. Keep the label→URL mapping in lockstep across Navbar (menu + hidden crawler anchors), prerender navs in `vite.config.ts`, `llms.txt`, `LegalScreen`, and `PoolStatsAppScreen`'s button. **Pricing/offer/payment-method copy is duplicated across many surfaces (PassesScreen, pageMeta, vite.config prerender, index.html JSON-LD, llms.txt, ABOUT.md, legal docs) — change them together and grep the built `dist/` to verify.**
- **Sales ledger in CAD (FX frozen at sale time)**: every completed sale appends a `sale_events` row (admin report `GET /admin/sales`). Pricing is USD, but the ledger reports CAD for Canadian tax, so each row freezes a pre-tx Bank of Canada USD→CAD rate (`fx.ts`, never throws: last-good → env fallback → ~1.37), taxes the CAD gross, and keeps USD source + rate for audit. Fetch the rate pre-tx and pass it in — never inside the tx.
- **Tiered stats**: `GET /stats` is tier-gated (anon → global/24h; account → personal/24h; pass → selectable window + global toggle + `refresh`). Stats/leaderboard/history/profile read the authoritative distilled summaries written at finalize (`gameSummary.ts` → `games.summary` + `game_participants.summary` + promoted discriminator columns), NOT `gameState.shotLog`; the per-player math lives in `gameSummary.ts` and mirrors `gameLogic.ts` — keep in lockstep. Bulk readers skip a row whose summary is absent/stale ("absent not corrupt") and subtract only those rows from the denominator (`gamesPlayed = rows.length − summaryless`), so a future `GAME_SUMMARY_VERSION` bump under-reports (omits old rows) until the one-time backfill reruns rather than mis-averaging. Per-row small pages (history/profile) prefer the summary with a defensive recompute fallback from the still-loaded `gameState`. Also carries a cosmetic `chaosWinRecent` flag (rainbow AVG-BPM flourish) from the last 10 completed games, flowing through `/games/profile`.
- **One host, many viewers**: the host device is the canonical scorekeeper. Others get a view-only mirror by joining an open seat before the break (`/join/:code`) or spectating by name (`/watch/:name`). Both render `JoinedGameScreen` and poll `/games/state`; neither can score. Spectating requires a paid host.
- **DB-auto-suspend-friendly closure & polling**: Postgres bills compute-time and suspends when idle — no background timers/cron. Stale games (60-min inactivity / hard 60-min cap) finalize lazily on owner access (`sweepStaleGames`) or when a viewer reads the specific row (`finalizeGameIfStale`). Poll cadences are tiered, and the `/watch/:name` pre-live resolve poll uses idle-backoff so unattended tabs let the DB suspend. Unfinalized games are merely absent from stats/history, never corrupt.
- **OBS overlay**: `/watch/:name?obs=1` renders the live HUD as a chrome-free, transparent overlay (OBS Browser Source) — reuses spectator resolution + polling, no new route. Collapses to a themed `:(` face when there's nothing to show. Flags: `&log=1` (compact shot log), `&scale=<n>` (0.2–5).
- **@Mention to link players (opt-in)**: a paid host types `@username` in a non-host slot to link a registered player without a join code. `GET /mentions/resolve` resolves live; on start the server mints a pending `game_mentions` row (gated on `tier==='pass'`). Mentions count toward nothing until the recipient **Accepts** on their Account page (creates their real participant slot); **Delete** ignores/removes. Pending-invite cap is recipient-tier-based.
- **Venue coordinates are address-authoritative**: a venue's pin comes from geocoding its saved `address` server-side (`resolveVenueCoords` → Nominatim), not typed lat/lng. An admin bulk-repair endpoint re-geocodes all venues. **Never overwrite coordinates on geocode failure.**
- **Per-hall & per-city leaderboards**: alongside the global 8-ball/9-ball boards, every active Verified Hall has its own board (`GET /leaderboard/hall`, route `/leaderboard/hall/:venueId`, resolvable by readable **slug** OR legacy id — exact-id match must win since the charsets overlap) and every hall locality rolls up into a city board (`GET /leaderboard/city`, route `/leaderboard/city/:locality`). All three share one ranking pipeline via a `LeaderboardScope` union. A finished 1-on-1 8/9-ball game is added by its **host, on location, after it ends**: `/games/hall-candidates` lists active halls within the radius cap, `/games/tag-hall` commits the tag, and `/games/tag-city` is the fallback when no hall is in range (sets `cityLocality`, leaves `venueId` null). The server re-computes the caller↔venue distance — client-supplied distance is never trusted. Tagging is one-shot per game (retag to a different target rejected; same target idempotent); the city locality is the hall's **hand-entered** label (no reverse-geocode). Hall pages are public, crawlable SEO surfaces (30-day window is sign-in-free; 90d/all-time are pass-gated) with per-page `<title>`/meta rendered client-side. Because admins mint halls AFTER the static build ships, they can't live in the build-time sitemap — they're served from the API at `/api/sitemap/venues.xml`, referenced from the static `<sitemapindex>` in `sitemap.xml`. The `/for-venues` page pitches the free listing (copy in `landingContent.ts`, prerendered + JSON-LD via `vite.config.ts`, meta in `pageMeta.ts`). `hall.totalPlayers` counts RANKED rows; a separate `taggedGames` distinguishes "no games tagged" from "tagged but none qualify."

## Product

- **Game modes**: 8-ball (2P/4P with teams, or 1P Shark), 9-ball, Practice. Shark = solo 8-ball vs an invisible honor-system AI (Normal steals on miss; Hard steals on miss + foul).
- **BPM tracking**: live per-player pace in the HUD; per-shot BPM stamped on pocketing entries. The HUD sublabel shows balls/group remaining.
- **Signed-in name lock**: the Player 1 name is prefilled + read-only when logged in (prevents stat pollution).
- **Join & spectate**: each game has a 5-char share code; others join an open seat before the break (view-only, guests allowed) or spectate by name. Joiners/spectators never score.
- **@Mention**: paid hosts link a registered friend by `@username` (no shared device needed); the friend gets an opt-in invite after the game finishes.
- **Stats & leaderboard**: `/stats` shows accuracy, pace, and ball/pattern breakdowns (retro CRT styling) with tier-gated windows. Recent Chaos winners get a rainbow AVG-BPM flourish. Plus separate **8-ball** and **9-ball** leaderboards ranked on a composite skill score (accuracy-weighted, trust-weighted pace; best-2 of ≥2 qualifying 1-on-1 games) — players appear after just 2 games. Anti-cheat signals (the raw composite score, how many games were between two registered players, and a thin-sample "provisional" flag) are hidden from players and surfaced only on an admin-only board (`GET /admin/leaderboard`). Plus per-venue **Local Leaderboards**: when a 1-on-1 8/9-ball game finishes, its host can 🏆 tag it — once, while on location — to a nearby Verified Hall, putting that game on the hall's own ranked board (and the rolled-up **City** board for that locality); if no hall is in range, the host can tag the city directly. Both boards are reachable from Find Players and the verified-hall cards (each card's locality is a clickable city link). Free accounts see the 30-day window; passes unlock 90-day/all-time.
- **List your hall (free)**: pool halls can claim a free Verified-Hall listing via the `/for-venues` pitch page — their own Local Leaderboard, map discovery, and a website backlink in exchange for a BreakBPM poster by the table.
- **Rematch / Resume**: signed-in players get a one-tap Rematch at game end (fresh game, same settings); logged-in users can resume an in-progress game cross-device.
- **Passes (crypto + redeem codes)**: free to play; sign in (free) to save stats. With crypto you buy **Purchase Days of Access** — any 1–365 days priced on marginal per-day brackets that get cheaper the more days you add (a single day is $1.99; the whole bracket set is env-tunable via `BREAKBPM_DAY_PASS_*`, shipped to the client via `/passes/plans`) — plus a **Lifetime** pass ($24.99) and **Lucky Break** ($4.99); none auto-renew. The original fixed Day/Month/Year/Lifetime one-time pass *kinds* still exist (the flexible pass issues a `day` kind with a custom duration, and redeem codes can still grant any kind), but Day/Month/Year are no longer sold directly via crypto — only the flexible day pass, Lifetime, and Lucky Break are crypto-buyable. A fifth **14 Day Pass** ($5.99 / 14d, kind `twoweek`) is sold *off-platform by card* via the owner's Squarespace store (`BREAKBPM_STORE_URL`): the buyer pays by card there, then the owner manually mints a "14 Day Pass" admin redeem code (existing admin generator) and emails it (≤24h). It is deliberately worse value than buying the equivalent ~14 days of access with crypto (~$3.29 at default rates) to nudge buyers toward crypto, and is NOT crypto-buyable (absent from the crypto catalog). Passes unlock full history, stats windows, spectating, Find Players posting, @mention, leaderboard windows, and full export; Lifetime adds custom screen names. (Legacy Stripe card checkout + recurring subscriptions exist behind an env flag, currently off; existing subscriptions can still cancel.)
- **Lucky Break**: a $4.99 "roll the rack" sold via redeem code — a guaranteed ≥30-day pass with a disclosed ~20% chance of Lifetime, shown via a provably-fair seeded reveal (see Architecture).
- **Redeem share links**: `/redeem/:code` stashes the code (30-min TTL, survives the sign-up redirect) then auto-applies `/passes/redeem` once signed in, including the Lucky Break reveal.
- **Invite link → free trial (one-sided, once per new user)**: every signed-in user has a personal, lazily-minted invite code (`users.inviteCode`, unique; `GET /passes/invite`). A NEW user who follows `/invite/{code}` and signs up gets a short, env-configurable free trial via `POST /passes/invite/accept` (`BREAKBPM_INVITE_TRIAL_HOURS`, issues a `day` pass with a custom sub-day duration). The whole accept runs in one tx: it resolves the inviter by code, blocks self-invites and non-new users (`INVITE_SIGNUP_WINDOW_MS` = 30 min on `createdAt`), pre-checks for an existing active pass, then grants + books a $0 comp in the sales ledger with a frozen pre-tx BoC FX rate. `UNIQUE(invited_user_id)` on `invite_redemptions` is the idempotency backstop (a second accept → `already_redeemed`). One-sided — no inviter reward. Client mirrors the redeem flow: `pendingInvite.ts` stashes the code across the sign-up redirect (30-min TTL, in lockstep with the server window), `InviteScreen` auto-applies once authed, and the top-level `RedeemResumer` resumes it (deferring to `?code`/`?game` joins and to a pending redeem).
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
- Invite link → free trial: `artifacts/api-server/src/lib/invites.ts` (server) + `artifacts/breakbpm/src/components/InviteScreen.tsx` / `src/lib/pendingInvite.ts` (client)
