# Gotchas

Tribal knowledge distilled from development sessions. Each entry describes a footgun, why it exists, and how to avoid it.

## API Server & Tooling

**No hot reload on api-server.** Editing `artifacts/api-server/src/` does nothing until you restart the api-server workflow. A stale server silently serves old responses.

**Codegen breaks Vite HMR.** Running `pnpm --filter @workspace/api-spec run codegen` while the frontend dev server is running can corrupt HMR. Restart the web workflow and hard-refresh after codegen.

**`pnpm run typecheck` is canonical.** Editor/LSP state can lag — trust the CLI output over IDE squiggles.

**Drizzle wraps pg error codes.** SQLSTATE codes (e.g. `23505`) live on `err.cause?.code`, not `err.code`. Inline `.code === "23505"` guards silently never fire → 500 instead of friendly refusal.

**Orval date-time query params are `zod.date()`.** Generated query schemas type date-time params as `Date`, not coerced strings. Routes must coerce ISO query strings before `safeParse` or every request 400s.

**Orval hooks need explicit `queryKey`.** Passing any `query` option to a generated `useX` hook makes `queryKey` required (TS2741). Pass `getXQueryKey()`.

**api-client-react vs api-zod date typing.** Client model types use `string` for date-time; api-zod uses `Date`. Send ISO strings in mutation bodies; import frontend types from `api-client-react`.

**Client fetch throws on non-2xx.** `customFetch` throws `ApiError` on any non-2xx, so in-body error `reason` fields are unreachable as `query.data`. Branch on `ApiError.status`.

## Entitlements & Payments

**Gate paid-host features on `tier === 'pass'`, not `hasActivePass`.** Subscriptions set `tier` but not `hasActivePass`. Gating on `hasActivePass` silently hides features from subscription-only users.

**Admin effective-Lifetime gating.** Gate Lifetime perks on `entitlement.isAdmin || entitlement.activePass?.isLifetime`, never raw `getActivePasses()`.

**Lifetime mutual exclusion.** Issuing Lifetime must stop active subscriptions from renewing on **every** grant path (purchase, dev-grant, redeem), inside the transaction.

**Stripe MCP ≠ Replit connector.** The Stripe MCP server and the app's Replit Stripe connector can be different accounts. The app only uses the connector.

**Stripe sale dual-path recording.** Both `/passes/verify` and the webhook must record the `stripe_purchase` sale (gated on `!grant.deduped`) or whichever path wins leaves zero ledger rows.

**Crypto manual-order claim safety.** Payer-less orders claimed by unique amount need atomic reservation AND replay lower-bound on the common verify path.

**Crypto Lucky Break roll seed.** Seed the on-chain draw with stable `order.id` (not `txHash`) so re-verify is deterministic.

**Free-claim comp ledger.** Giveaway redemptions must book $0 comp even for Lucky Break, or a free roll records phantom revenue.

## Game Logic & State

**Team-assignment pre-pocket contract.** `shouldAssignTeams` runs **before** the pocketed ball is appended. 8-ball ruleSet timing depends on this ordering.

**GameState rehydration paths.** A new `GameState` field must be added to `createInitialGameState`, encode/decode, App `?state=` restore, **and** `SetupScreen.handleResume` or it silently drops (rematch lost @mentions this way).

**Shark Level = wins.** `sharkLevel` counts Shark-mode wins (`winner = displayName AND winner ≠ 'Shark'`). Computed in both `computePersonalStats` and `computeLeaderboard` — keep in sync.

**History card subject-relative outcome.** Stored outcome/winner isn't viewer-aware. Recompute WIN/LOSS per-subject by `slotIndex`; pace from slot player name, not host row.

**Mention-accept on finalized games.** Accepting an @mention after finalize creates the slot too late. Re-distill summaries + bust caches or the accepted player's stats vanish.

**Delete-my-data scope.** Per-game: full-delete when no other real player remains; else anonymize caller to "🕴️ Mr. X" everywhere + null their slot. Never drop shot entries. Bust stats cache after.

**Per-game removal cache bust.** `removeUserFromGameTx` must snapshot participant `userIds` **inside** the tx (full-delete drops rows). `bustGameStatsCache(gameId)` reads them too late.

**Stats cache bust on completion.** Every game-completion path (save, abandon, leave, stale-sweep) must clear all participants' stats cache.

## Leaderboards & Stats

**Filter before rank when capping.** Top-N endpoints must put qualifying filters inside the aggregate WHERE/JOIN before ORDER BY/LIMIT. Post-filter over-fetch silently drops valid rows.

**Bulk-stats summary-skip denominator.** Skipped (absent/stale-summary) rows must leave both numerator and denominator (`gamesPlayed = rows.length − summaryless`).

**Hall leaderboard counts.** `totalPlayers` = ranked rows; separate `taggedGames` distinguishes "no games tagged" from "tagged but none qualify."

**Venue slug resolution.** `/leaderboard/hall/:venueId` resolves slug OR legacy id. Exact id match must win (charsets overlap) — never `or(...).limit(1)`.

**Tag-hall race.** Guarded `UPDATE ... WHERE venue_id IS NULL` alone is not enough. Use `.returning()` and check row count; on zero rows, re-read for idempotent success vs `already_tagged`.

## Venues & Maps

**Venue pin placement.** Saved address is authoritative (server geocodes on save). **Never overwrite coordinates on geocode failure.**

**Venue list vs compass coupling.** `GET /venues` serves a paginated list AND the nearest-hall compass (needs ALL venues via `?all=true`). Paginating the compass silently breaks "nearest."

**Overpass venue proxy.** OSM billiards fetch must be server-side (browser union query gets WAF 406).

**Leaflet marker position.** Custom divIcon classes must stay `position: absolute`. A `relative` class drifts pins off tiles.

**Find Players active boundary.** "Today" gate uses the poster's local date; storage/display stay UTC wall-clock.

## Frontend & UI

**Clerk duplicate verification emails.** Inline `Route component={() => ...}` remounts `<SignIn>`/`<SignUp>`, re-sending codes. Use stable named route components.

**Auth-redirect intent handoff.** Carry per-link intent via localStorage stash + top-level resumer on `/`, not route-local effects.

**Back button uses real browser history.** "← Back" must use `goBack(fallback)` from `useGoBack()`, not hardcoded `setLocation`.

**breakbpm scroll containers.** `app-window--page` scrolls the document; other pages scroll `.app-body`. Reset both on route-change scroll-to-top.

**Panel flex-shrink clipping.** `.app-body` flex column compresses `.panel` when content > viewport. Fix: `.panel { flex-shrink: 0 }`.

**Visual editor color edits lose to CSS.** Fix colors in `index.css`, not inline Tailwind classes.

**bg-clip:text animation needs inline.** Animated rainbow text must be on an inline/inline-block element.

## Copy & SEO Lockstep

**Pricing/offer copy is duplicated** across PassesScreen, pageMeta, vite.config prerender, index.html JSON-LD, llms.txt, and ABOUT.md. Grep built `dist/` after changes.

**Lucky Break disclosure lockstep.** Changes to entropy source/window/odds must update PassesScreen, LuckyBreakReveal, README, and ABOUT.md.

**Runtime-configurable client values** go via `GET /config`, not `VITE_*` build-time vars.

## Database & Deploy

**DB auto-suspend.** No `setInterval`/cron touching the DB. Finalize stale games lazily on access; tier/idle-backoff polls.

**Backfill rollout gap.** One-time backfills don't reach prod automatically. Ship lazy read-path self-heal + add to `scripts/post-merge.sh`.

**api-server deploy startup-probe.** Bind port fast (tiny HTTP bootstrap + esbuild splitting) or autoscale promote fails.

**admin-sales test DB pollution.** `admin-sales.test.ts` assumes empty `sale_events`; leftover dev rows inflate counts.

## vite.config.ts

**Bare imports crash the config loader.** Importing a src helper that transitively pulls `@workspace/*` → `ERR_MODULE_NOT_FOUND`. Duplicate small constants locally.