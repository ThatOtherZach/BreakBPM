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
- Payments: Stripe (passes/checkout)

## Where things live

```
artifacts/
  breakbpm/           React frontend
    src/
      App.tsx           App shell — routing, game persistence, auth gating
      lib/
        gameLogic.ts    Pure game engine (8-ball, 9-ball, practice, Shark)
        authClient.tsx  Clerk seam — useAuth(), AuthProvider, SignedIn/Out
      components/
        SetupScreen.tsx  Game setup — mode, player count, names, Shark aggression
        GameScreen.tsx   Active game HUD, shot logging, BPM display
        AccountScreen.tsx  Profile, pass status, history
        Navbar.tsx
  api-server/         Express backend
    src/
      index.ts          Server entry, port binding
      routes/           games.ts, auth.ts, passes.ts
      lib/auth.ts       Clerk → local user upsert

lib/
  db/src/schema/      Drizzle schema (source of truth for DB shape)
    users.ts          users table (Clerk ID → screenName, onboarding)
    games.ts          games table (gameState JSONB, bpm_x10, last_activity_at)
    passes.ts         passes table (Day/Year/Lifetime entitlements)
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

## Product

- **Game modes**: 8-ball (2P or 4P with team assignment, or 1P Shark mode), 9-ball, Practice (solo drills)
- **Shark mode**: Solo 8-ball vs an invisible AI opponent. Misses and fouls feed balls to the Shark. Aggression toggles between Normal (steals on miss) and Hard (steals on miss + foul).
- **BPM tracking**: Each player's live pace is shown in the HUD. Per-shot BPM is stamped on pocketing entries in the shot log so pace can be traced shot by shot.
- **HUD sublabel**: In 8-ball after teams are assigned, shows "N SOLIDS/STRIPES LEFT" (including the 8-ball in the count) or "8-BALL TO WIN" once the group is cleared. Other modes show "N BALLS LEFT".
- **Signed-in name lock**: When logged in, the Player 1 name field is prefilled with the user's screen name and made read-only, preventing stat pollution across all game modes.
- **Resume**: Logged-in users can resume an in-progress game from a different device via the server-side snapshot.
- **History & passes**: Game history is stored per-user. Free users see limited history; Day/Year/Lifetime passes unlock full access (redeemable via code or Stripe checkout).

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
