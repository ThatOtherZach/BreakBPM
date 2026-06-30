# Threat Model

## Project Overview

BreakBPM is a publicly deployed billiards scoring application with a React frontend and an Express API backed by PostgreSQL. Users can play or watch games, maintain public player profiles and history, buy or redeem entitlements, and admins can mint codes and access sales data. Authentication is provided by Clerk, and payment-related flows integrate with Stripe and on-chain crypto verification.

Production scope for this repo is the `artifacts/breakbpm` frontend, the `artifacts/api-server` backend, and shared libraries under `lib/`. `artifacts/mockup-sandbox` is development-only and should be ignored unless separate evidence shows it is reachable in production.

## Assets

- **User accounts and sessions** — Clerk-backed authenticated sessions and the local `users` table. Compromise would allow impersonation, account changes, and access to private account functions.
- **Game data and participation state** — in-progress game state, share codes, participant assignments, history, mentions, and spectator resolution data. These control who can view live games and whose stats/history are affected.
- **Payment and entitlement state** — passes, subscriptions, discount codes, crypto orders, Lucky Break rolls, and sales ledger rows. Integrity matters because these records directly determine paid access and financial reporting.
- **Admin privileges** — allowlisted admin identities, admin-minted codes, and sales exports. Abuse would permit unauthorized code minting or access to financial records.
- **Application secrets and provider credentials** — database connection, Clerk secret, Stripe connector credentials, and crypto receiving configuration. Exposure would compromise authentication, payments, or data.
- **Public profile and discovery data** — screen names, public watch handles, Find Players posts, recent public-facing stats, and related live-game or meetup metadata. These are intentionally exposed in limited ways and must not leak more than designed; precise meetup coordinates and live spectator state should be treated as sensitive even when some related discovery data is public.

## Trust Boundaries

- **Browser to API** — all frontend requests cross from an untrusted client into the Express API. Client-side gating is not authoritative.
- **API to PostgreSQL** — the server has broad read/write access to game, account, entitlement, and sales data. Injection or authorization flaws here can directly expose or corrupt core data.
- **API to Clerk** — authentication depends on Clerk middleware and user lookups; the app trusts Clerk identities after verification.
- **API to Stripe** — Stripe is authoritative for card payments and subscription lifecycle. Webhooks and checkout verification must be authenticated and ownership-checked.
- **API to blockchain / pricing sources** — crypto verification and ETH/USD pricing rely on external network data. The app must treat those sources as untrusted until validated.
- **Public vs authenticated vs paid vs admin** — several routes are intentionally public, others require a signed-in user, some require paid entitlement, and a small set require admin allowlist membership.
- **Production vs dev-only** — the mockup sandbox is assumed non-production; production scanning should stay focused on the deployed app unless code paths are shared.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/*.ts`, `artifacts/breakbpm/src/App.tsx`.
- **Highest-risk areas:** `routes/games.ts`, `routes/findPlayers.ts`, `routes/venues.ts`, `routes/passes.ts`, `routes/subscriptions.ts`, `routes/crypto.ts`, `routes/admin.ts`, `lib/paymentProvider.ts`, `lib/stripeReconcile.ts`, `lib/auth.ts`, `lib/clerkAuthProvider.ts`.
- **Public surfaces:** `/games/resolve`, `/games/join`, `/games/state`, `/games/watch-resolve`, `/games/profile`, `/stats` (limited mode), `/leaderboard`, `/leaderboard/hall` (per-hall board, 30-day window is sign-in-free as a crawlable SEO surface; 90d/all-time are pass-gated), `/passes/plans`, `/config`, Find Players listing.
- **Privacy-sensitive public-adjacent surfaces:** watch-by-name spectator resolution, share-code game-state polling, and Find Players location publication/geocoding flows. These are likely to create real information-disclosure issues even when they do not expose classic account secrets. **Precise meetup coordinates are now entitlement-gated**: the Find Players listing returns exact lat/lng only to the post's owner or a paid (`tier==='pass'`) caller, and returns a coarse locality label to other signed-in users (signalled by `preciseLocationsVisible` on the list response). Verified venue coordinates are intentionally exact for any signed-in user.
- **Authenticated / paid / admin surfaces:** account routes, game writes, redeem and checkout verification, mention acceptance/deletion, discount-code generation, admin code minting, `/admin/sales`, venue listing (`GET /venues`, any signed-in user), admin venue management (`POST/PATCH/DELETE /admin/venues`, admin-allowlist only), the per-city leaderboard (`/leaderboard/city`, sign-in required for every window), and on-location game tagging (`/games/hall-candidates`, `/games/tag-hall`, `/games/tag-city`). Tagging is host-only and **server-authoritative on proximity**: the server re-validates host/finalized/type/not-already-tagged and re-computes the caller↔venue distance against a fixed radius cap server-side (client-supplied distance and venue choice are never trusted), and tagging is one-shot per game — so it is not a new spoofing/tampering vector for ranking placement.
- **Dev-only areas usually out of scope:** `artifacts/mockup-sandbox/**`, tests, and one-off scripts unless they are imported by production code.

## Accepted Risk Notes

- The current composition of `/games/watch-resolve` and `/games/state` exposes live spectator data to anyone who knows a public screen name or live share code, even when `/games/join` would say spectating is disabled for an unpaid host. The operator is aware of this and has chosen to defer remediation unless abuse becomes regular, so future scans should not re-propose this exact issue unless the exposure materially expands.

## Threat Categories

### Spoofing

BreakBPM relies on Clerk-backed browser sessions for authenticated account, payment, and admin actions. The API must only trust identities established by Clerk middleware, and every authenticated route must bind sensitive actions to the current verified user rather than client-supplied identifiers. Payment verification flows must also prove that a checkout session, subscription, or crypto order belongs to the caller before granting entitlements.

### Tampering

The client can submit game state, game completion details, redeem codes, checkout tokens, crypto transaction hashes, and public-post metadata. The server must treat all of these as attacker-controlled, validate them strictly, and enforce authorization and business rules server-side. Entitlement changes, code redemption limits, and financial ledger writes must remain atomic so concurrent requests cannot create duplicate grants or inconsistent accounting.

### Information Disclosure

The app intentionally exposes some public data through watch links, public profiles, spectator APIs, and Find Players posts. Those public capabilities must not reveal more data than intended, and authenticated/admin routes must not leak account, sales, or entitlement details across users. Particular care is required around live spectator state and meetup-location precision, because those flows can expose sensitive real-time or real-world data even without exposing traditional secrets. Logs and API responses must avoid exposing secrets, raw payment credentials, redeemable codes, or unnecessary personal data.

### Denial of Service

Several endpoints are public and poll-driven, especially spectator and profile flows. The app must keep request bodies bounded, rate-limit brute-forceable public capabilities, and avoid expensive unauthenticated operations that can be triggered repeatedly. External lookups such as geocoding, Stripe, and chain reads must use timeouts or bounded retries so upstream failures do not pin server resources indefinitely.

### Elevation of Privilege

The highest-impact failures would let a regular user act as another player, claim someone else’s payment, read private game/account data, or reach admin-only capabilities. Server-side authorization must therefore protect game writes, account changes, mention management, entitlement grants, and admin routes. Public capability URLs such as watch handles and share codes must be strong enough, rate-limited appropriately, and scoped so they do not become a shortcut around intended access controls.
