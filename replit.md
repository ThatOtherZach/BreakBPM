# BreakBPM

A billiards scoring app that tracks shots, calculates per-player Balls Per Minute (BPM), and logs game history across 8-ball, 9-ball, and practice modes.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

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
      components/
        SetupScreen.tsx  Game setup — mode, player count, names, Shark aggression
        GameScreen.tsx   Active game HUD, shot logging, BPM display
        StatsScreen.tsx  Tiered shooting stats (retro CRT/PC-98 styling)
        JoinedGameScreen.tsx  View-only HUD for joiners + spectators (/join/:code)
        WatchByNameScreen.tsx  Spectate by player name (/watch/:name)
        AccountScreen.tsx  Profile, pass/subscription status, history
        PassesScreen.tsx   Pass + subscription purchase/redeem
        AboutScreen.tsx    Renders ABOUT.md
        Navbar.tsx
  api-server/         Express backend
    src/
      index.ts          Server entry, port binding
      routes/           games.ts, auth.ts, passes.ts, subscriptions.ts, health.ts
      lib/
        auth.ts         Clerk → local user upsert
        stats.ts        Tiered /stats aggregation (personal vs global)
        entitlement.ts  Resolves a user's Tier (public/account/pass) from passes + subs
        subscriptions.ts  Recurring subscription lifecycle
        shareCode.ts    5-char share-code generation + normalization
        forfeit.ts      Server forfeit/timeout constants

lib/
  db/src/schema/      Drizzle schema (source of truth for DB shape)
    users.ts          users table (Clerk ID → screenName, onboarding)
    games.ts          games table (gameState JSONB, bpm_x10, last_activity_at)
                      + game_participants (per-player slots, displayName, stats window)
    passes.ts         passes table (Day/Lifetime one-time entitlements)
    subscriptions.ts  subscriptions table (Monthly/Yearly recurring entitlements)
    discountCodes.ts  one-time/limited-use codes
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
- **Tiered entitlements**: `entitlement.ts` resolves a caller into one of three `Tier`s — `public` (anonymous), `account` (signed in, no entitlement), `pass` (active pass OR subscription). One-time passes (Day/Lifetime) live in `passes`; recurring plans (Monthly/Yearly) live in `subscriptions` as a separate source. `entitlement.hasActivePass` reflects one-time passes only; gate "paid host" features on `tier === 'pass'`. Buying Lifetime stops any active subscription from renewing (enforced in-tx on every grant path).
- **Tiered stats**: `GET /stats` is gated by tier. Anonymous → global scope, 24h window. Signed-in (no pass) → personal scope, 24h. Pass holders → personal stats with selectable window (24h/30d/365d/all) and a global toggle, plus `refresh=true` to bypass the 1h server cache. Personal stats are recomputed from each game's `shotLog` (the denormalized `games.bpm`/`accuracy` columns are host-centric); the per-player math in `stats.ts` deliberately mirrors `gameLogic.ts` and must be kept in lockstep.
- **One host, many viewers**: The host device is the canonical scorekeeper. Others get a view-only mirror — either by **joining** an open seat before the break (`/join/:code`, occupies a slot, guests get a `guestToken`) or **spectating** any time (`/watch/:name` resolves a player's live game). Both render `JoinedGameScreen` and poll `/games/state`; neither can score or undo. Spectating requires the host to be a paid tier.

## Product

- **Game modes**: 8-ball (2P or 4P with team assignment, or 1P Shark mode), 9-ball, Practice (solo drills)
- **Shark mode**: Solo 8-ball vs an invisible AI opponent. Misses and fouls feed balls to the Shark. Aggression toggles between Normal (steals on miss) and Hard (steals on miss + foul). Ball removal is honor-system: when the Shark pockets, the player either lifts an easy-looking Shark ball off the real table or shoots one of the Shark's balls themselves, then taps it in the selector to keep the on-screen rack in sync.
- **BPM tracking**: Each player's live pace is shown in the HUD. Per-shot BPM is stamped on pocketing entries in the shot log so pace can be traced shot by shot.
- **HUD sublabel**: In 8-ball after teams are assigned, shows "N SOLIDS/STRIPES LEFT" (including the 8-ball in the count) or "8-BALL TO WIN" once the group is cleared. Other modes show "N BALLS LEFT".
- **Signed-in name lock**: When logged in, the Player 1 name field is prefilled with the user's screen name and made read-only, preventing stat pollution across all game modes.
- **Join & spectate**: Each game has a 5-char share code. Others can join an open seat before the break (view-only, guests allowed, can leave/forfeit) or spectate a player's live game by name. Joiners and spectators see the host's HUD, shot log, and BPM live but never score.
- **Stats page**: `/stats` shows shooting stats (results, accuracy, pace, ball/pattern breakdowns) with retro CRT styling. Windows and personal/global scope are unlocked by tier (see Tiered stats above).
- **Resume**: Logged-in users can resume an in-progress game from a different device via the server-side snapshot.
- **History, passes & subscriptions**: Game history is stored per-user. Free users see limited history; Day/Lifetime passes and Monthly/Yearly subscriptions unlock full access (redeemable via code or Stripe checkout). Subscriptions renew until cancelled; access lasts through the paid period.

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
