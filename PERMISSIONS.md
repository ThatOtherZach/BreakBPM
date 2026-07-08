# BreakBPM — Feature Access & Permissions

A single reference for **who can do what** in BreakBPM. Every rule here is
enforced server-side and was derived from the actual route guards (not the UI) —
see [Where each rule is enforced](#where-each-rule-is-enforced) for the source of
truth behind each claim.

> **TL;DR on payments:** Card (Stripe) and on-chain crypto checkout are **built
> but currently inactive** (both behind default-off flags). The only active paid
> path today is **redeem codes** — Lucky Break codes and admin-minted comp codes.
> See [Payment methods & feature flags](#payment-methods--feature-flags).

---

## How access is decided

Access is resolved in five independent layers. A request must satisfy *all* the
layers that apply to the feature it touches:

1. **Entitlement tier** — every caller resolves to exactly one of three tiers
   (`public`, `account`, `pass`). This is the main axis for most features.
2. **Admin allowlist** — a small set of accounts (by email) are treated as
   effective Lifetime holders *and* unlock admin-only tools.
3. **Lifetime-only perks** — a couple of perks require a *Lifetime* pass
   specifically (a generic paid pass/subscription is not enough). Admins qualify.
4. **Capability tokens** — some access is granted by *holding a secret/handle*
   rather than by identity: share codes, watch-by-name handles, guest tokens,
   and redeem codes.
5. **Runtime feature flags** — payment methods are switched on/off by
   `BREAKBPM_*` environment flags, independent of who is asking.

---

## The three tiers

Tiers are resolved by `computeEntitlement(user)` in
`artifacts/api-server/src/lib/entitlement.ts`.

| Tier | Who | How it's resolved | History visibility |
|---|---|---|---|
| **public** | Anonymous / signed-out | No authenticated user | **0** games (none) |
| **account** | Signed in, no entitlement | Authenticated, but no active pass and no active subscription | **3** most recent games (`HISTORY_LIMIT_FREE_ACCOUNT`) |
| **pass** | Paid | Has an **active one-time pass** *(Day/Month/Year/Lifetime)* **OR** an **active subscription** *(Monthly/Yearly)* | **Unlimited** |

Notes:

- **`pass` = pass OR subscription.** Either source grants the `pass` tier. This
  is the single place "either source grants access" lives.
- **`hasActivePass` ≠ `tier`.** `entitlement.hasActivePass` reflects **one-time
  passes only**; an active subscription sets `tier === 'pass'` but leaves
  `hasActivePass === false`. **Gate "paid host" features on `tier === 'pass'`,
  never on `hasActivePass`.**
- A pass is active when `startedAt <= now < expiresAt`; Lifetime uses a
  far-future sentinel expiry and is flagged `isLifetime`.

---

## Admins

- Admins are accounts whose email is on the **`BREAKBPM_ADMIN_EMAILS`** allowlist
  (comma-separated, matched case-insensitively).
- An admin is synthesized as an **effective Lifetime holder**: `tier: 'pass'`,
  `hasActivePass: true`, unlimited history, `activePass.isLifetime: true`, and
  `isAdmin: true`. A **real** pass always takes precedence over the synthetic one.
- The allowlist itself is **never** sent to the client. Only a single per-user
  boolean (`isAdmin`) is ever exposed.

Admins get every capability that routes through `computeEntitlement()` — i.e.
every `pass`-tier and Lifetime-only capability in this document — **plus** these
admin-only tools (each returns **403** for non-admins):

| Admin-only capability | Endpoint(s) |
|---|---|
| Mint pass-granting comp codes (any tier, chosen use cap, never expire) | `GET/POST /passes/admin/codes` |
| Sales ledger report (CSV + totals, in CAD) | `GET /admin/sales` |
| Venue management (create / edit / delete) | `GET/POST/PATCH/DELETE /admin/venues` |
| Repair venue pins from addresses | `POST /admin/venues/repair-coordinates` |

> **Caveat — two helpers read *raw* passes, not the synthesized admin Lifetime.**
> Host-spectating availability and the pending-invite cap are computed by
> `hostSpectatingEnabled()` from raw active passes/subscriptions, **not** through
> `computeEntitlement()`. So an admin who holds **no real pass or subscription**
> is treated as a *free* host for those two cases only: their own live games are
> not spectatable via the official spectator role, and they receive the **free**
> invite cap of 3 (not 6). Holding/redeeming any real pass removes the exception.

---

## Lifetime-only perks

These require a **Lifetime** pass specifically — a Day/Month/Year pass or a
subscription does **not** unlock them. **Admins qualify** (effective Lifetime).
The gate is `entitlement.isAdmin || entitlement.activePass?.isLifetime === true`.

| Perk | Who | Notes |
|---|---|---|
| **Custom screen-name editing** (`PATCH /auth/screen-name`) | Lifetime or admin | 403 otherwise. Name must match `^[A-Za-z0-9_-]{2,30}$`, unique case-insensitively. |
| **Day-Pass gifting** (`POST /passes/discount-codes`) | **Year or Lifetime** pass holders, or admin | Mints one single-use Day-Pass code per 12h (24h expiry). *(This is the one Lifetime-area perk that also admits Year holders.)* |

---

## Feature access matrix

✅ = allowed · ❌ = not allowed · ⚙️ = depends on a feature flag (see
[flags](#payment-methods--feature-flags)). "Capability" means access comes from
holding a token/handle, not from the tier.

| Feature | public | account | pass | admin | Enforcement notes |
|---|:---:|:---:|:---:|:---:|---|
| Play & score a game locally | ✅ | ✅ | ✅ | ✅ | Scoring is client-side; the host device is the canonical scorekeeper. |
| Cross-device resume of an in-progress game | ❌ | ✅ | ✅ | ✅ | Requires sign-in (server-side snapshot). |
| Game **history** depth | 0 | 3 | ∞ | ∞ | Per `historyVisibleLimit`. |
| Export my data (`GET /games/export`) | ❌ | last 24h | full | full | 401 if signed out; free accounts capped to the free window, `pass` exports everything. |
| Delete my data (`DELETE /games/data`) | ❌ | ✅ | ✅ | ✅ | Scoped to the caller's own participation. |
| **Stats** scope/window | global, 24h (forced) | personal 24h; may toggle global (all-time) | personal with selectable window (24h/30d/365d/all) + global toggle + refresh | same as `pass` | `GET /stats`. `canChooseWindow`/`canRefresh` are `pass`-only; `canToggleGlobal` is `account`+`pass`. |
| Account identity chips — own **all-time Defense** | ❌ | ✅ | ✅ | ✅ | `GET /auth/me` puts the caller's own all-time `defenseRate`/`defenseSuccesses`/`defenseSafeties` on `account` — an **intentional** free-tier carve-out from the 24h stats clamp (teaser; precedent: `globalStanding` already exposes all-time BPM/ACC). Not a leak. |
| **Leaderboard** window | 30d only | 30d only | 30d / 90d / all-time | all | `GET /leaderboard`; 90d & all-time return 403 `pass_required` for non-pass. |
| Public profile / watch resolution | ✅ | ✅ | ✅ | ✅ | `GET /games/profile`, `GET /games/watch-resolve` — capability = the screen name. **Not** host-paid gated. Fixed 5-game showcase; tier does not change it. |
| **Spectate** via the official seat/role (`/games/join`) | gated on **host** | gated on **host** | gated on **host** | gated on **host** | The view-only spectator *role* is granted only when the **HOST is paid** (real pass or active subscription). The watcher pays nothing. |
| Live game state by share code / watch handle (`/games/state`, `/games/watch-resolve`) | capability | capability | capability | capability | **Not** host-paid gated — reachable by anyone holding a live share code or public screen name (**accepted risk**, see below). |
| **Join** an open seat pre-break (share code) | ✅ (guest) | ✅ | ✅ | ✅ | Always free; anonymous joiners get a `guestToken`. View-only — joiners never score. |
| **@Mention** linking when starting a game | ❌ | ❌ | ✅ | ✅ | Attaching mentions requires host `tier === 'pass'`; resolve lookup (`GET /mentions/resolve`) also `pass`-only. |
| Receive / accept / delete @mention invites | ❌ | ✅ | ✅ | ✅ | Any signed-in recipient. Pending-invite cap: **3** (recipient with no real pass/sub) / **6** (recipient with a real pass/sub). |
| **Find Players** — view list | ❌ (empty) | ✅ | ✅ | ✅ | Signed-out gets an empty list. |
| **Find Players** — precise vs coarse location | — | coarse label only (own posts exact) | **exact** lat/lng | exact | `canSeeExact = tier === 'pass'` (or the post's owner); others get `locationLabel`. Surfaced as `preciseLocationsVisible`. |
| **Find Players** — create a post | ❌ | ❌ | ✅ | ✅ | `tier === 'pass'` required (else `not_paid`). Max **5** active posts per user. |
| **Venues** — view (`GET /venues`, `/venues/osm`) | ❌ | ✅ | ✅ | ✅ | Any signed-in user; signed-out gets empty / 401. |
| **Venues** — manage | ❌ | ❌ | ❌ | ✅ | Admin-only (403 otherwise). |
| Custom screen name | ❌ | ❌ | Lifetime only | ✅ | See [Lifetime-only perks](#lifetime-only-perks). |
| Gift a Day Pass | ❌ | ❌ | Year/Lifetime only | ✅ | See [Lifetime-only perks](#lifetime-only-perks). |
| Redeem a code (`POST /passes/redeem`) | ❌ | ✅ | ✅ | ✅ | Any signed-in user. The active paid path (Lucky Break + admin codes). |
| Card checkout (passes & subscriptions) | ❌ | ⚙️ | ⚙️ | ⚙️ | Behind `BREAKBPM_CARD_PAYMENTS_ENABLED` — **currently inactive**. Signed-in required when on. |
| Crypto checkout (one-time passes) | ❌ | ⚙️ | ⚙️ | ⚙️ | Behind `BREAKBPM_CRYPTO_PAYMENTS_ENABLED` **and** a configured receiving address — **currently inactive**. |
| Cancel a subscription (`POST /subscriptions/cancel`) | ❌ | ✅ | ✅ | ✅ | Stays available even while card payments are off, so legacy subs can be stopped. |
| Admin tools (code minting, sales, venue mgmt) | ❌ | ❌ | ❌ | ✅ | See [Admins](#admins). |

---

## Capability-based access (not identity-based)

Some access is granted by **possessing a token or handle**, regardless of tier:

- **Share code (5 chars)** — per game. Lets anyone **join an open seat** before
  the break — joining is always free. The official view-only spectator *role*
  (via `/games/join`) is host-paid gated, but the live game state itself
  (`/games/state`) is reachable by anyone holding the code regardless of host
  tier (**accepted risk**).
- **Watch-by-name handle (the player's screen name)** — the public capability
  behind `/watch/:name`. `/games/watch-resolve` finds the player's live game and
  `/games/profile` returns their fixed 5-game showcase — **neither is host-paid
  gated** (only the official join/spectator role is). Also powers the chrome-free
  **OBS overlay** (`?obs=1`).
- **Guest token** (`randomUUID`) — handed to an anonymous joiner so their
  view-only seat survives reloads / re-syncs without an account.
- **Redeem code & `/redeem/:code` share link** — applies an entitlement after
  sign-in. The link stashes the code (30-min TTL across the sign-up/sign-in
  redirect), then auto-applies it via `POST /passes/redeem`. Works for Lucky
  Break codes (runs the provably-fair roll) and admin comp codes.

> **Accepted risk:** spectator resolution + game-state polling are reachable by
> anyone who knows a public screen name or a live share code. This is a known,
> deliberately-deferred exposure (see `threat_model.md`).

---

## Payment methods & feature flags

All payment availability is **runtime/env-driven**. The table lists each flag's
**code default** and its **current live status** (the latter is operational
reality, not visible in code).

| Flag | Code default | Current status | What it gates |
|---|:---:|:---:|---|
| `BREAKBPM_CARD_PAYMENTS_ENABLED` | **off** | **Inactive** | `/passes/checkout`, `/passes/verify`, `/subscriptions/checkout`, `/subscriptions/verify`. When off, these return a friendly refusal and `/passes/plans` reports `cardPaymentsEnabled: false` so the UI hides card purchase. **`/subscriptions/cancel` stays on.** |
| `BREAKBPM_CRYPTO_PAYMENTS_ENABLED` | **off** | **Inactive** | `/crypto/quote`, `/crypto/verify`. Even when on, the flow only opens if **`BREAKBPM_CRYPTO_RECEIVING_ADDRESS`** is also set. No crypto subscriptions (one-time passes only). |
| `BREAKBPM_CRYPTO_RECEIVING_ADDRESS` | (unset) | Unset | On-chain receiving wallet. Required (with the flag) for crypto checkout to actually open. |
| `BREAKBPM_ADMIN_EMAILS` | (empty) | Operator-set | The admin allowlist (comma-separated emails). Never sent to the client. |
| `BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY` | `0.20` | Operator-tunable | Disclosed Lifetime-upgrade odds for a Lucky Break roll (decimal in `[0,1]`; invalid → warn + default). |
| `BREAKBPM_PROMO_QR_URL` | `https://breakbpm.com` | Operator-tunable | URL behind the splash-art QR easter egg. Read per-request. |
| `BREAKBPM_USD_CAD_FALLBACK_RATE` | ~`1.37` | Operator-tunable | USD→CAD fallback used only when the Bank of Canada FX lookup is unreachable and no last-good rate is cached. |

**The active paid path today:** redeem codes. A **Lucky Break** code
(`$4.99`, "roll the rack") guarantees at least 30 days of access with a
disclosed chance (default 20%) of Lifetime; **admin comp codes** and **card-store
codes** (30 Day Pass, manually emailed) grant the tier the admin picks. Card and
crypto endpoints + UI remain intact behind their flags and can be switched back
on without a code change (restart the api-server workflow after changing a flag).

### Plan & price catalog (single source of truth: `pricing.ts`)

| Plan | Price (USD) | Kind / channel |
|---|---|---|
| Purchase Days of Access | $1.99 first day; marginal brackets to 365d (**$4.99/30d** at defaults) | crypto flexible `day` pass (when enabled) |
| 30 Day Pass | $4.99 / 30d | off-platform card store → admin redeem code (`twoweek` kind); same price as 30d crypto |
| Lifetime | $24.99 | one-time pass (crypto or redeem) |
| Lucky Break | $4.99 | redeem-code roll (30-day floor, chance of Lifetime) |
| Day / Month / Year passes | $1.99 / $4.99 / $14.99 | redeem-code grants only (legacy kinds; not sold direct via crypto) |
| Monthly / Yearly subscriptions | $4.99 / mo · $14.99 / yr | Stripe (flag-gated, currently off) |

*(Crypto, when enabled, sells flexible days, Lifetime, and Lucky Break — no
recurring crypto plans. Card checkout and subscriptions are behind
`BREAKBPM_CARD_PAYMENTS_ENABLED`, currently off.)*

---

## Where each rule is enforced

| Area | File |
|---|---|
| Tier resolution, admin synthesis, history limits | `artifacts/api-server/src/lib/entitlement.ts` |
| Flags, admin allowlist, refusal messages | `artifacts/api-server/src/lib/config.ts` |
| Plan catalog & prices | `artifacts/api-server/src/lib/pricing.ts` |
| Spectate gate, join/guest tokens, @mentions, stats/leaderboard gating, profile/watch | `artifacts/api-server/src/routes/games.ts` |
| Find Players location precision & post creation | `artifacts/api-server/src/routes/findPlayers.ts` |
| Venue view vs admin management | `artifacts/api-server/src/routes/venues.ts` |
| Sales report (admin-only) | `artifacts/api-server/src/routes/admin.ts` |
| Lifetime screen-name perk | `artifacts/api-server/src/routes/auth.ts` |
| Redeem, card checkout, gift codes, admin code minting | `artifacts/api-server/src/routes/passes.ts` |
| Subscription checkout / cancel | `artifacts/api-server/src/routes/subscriptions.ts` |
| Crypto checkout | `artifacts/api-server/src/routes/crypto.ts` |
| Day-Pass gift eligibility | `artifacts/api-server/src/lib/giftCodes.ts` |
| Admin comp-code minting | `artifacts/api-server/src/lib/adminCodes.ts` |

> This document describes the access model only — it changes no rules. If a guard
> in the files above ever changes, update the matching row here so the matrix
> never drifts from the code.
