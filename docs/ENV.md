# Environment Variables

All optional flags are read by the API server at runtime. Restart the `api-server` workflow after changing any value.

## Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |

Clerk credentials are configured via the Clerk integration; the frontend reads a publishable key.

## Payments & Pricing

| Variable | Default | Description |
|---|---|---|
| `BREAKBPM_CARD_PAYMENTS_ENABLED` | `false` | Enables Stripe card checkout for passes and subscriptions |
| `BREAKBPM_CRYPTO_PAYMENTS_ENABLED` | `false` | Enables on-chain checkout (Base USDC / native ETH) |
| `BREAKBPM_CRYPTO_RECEIVING_ADDRESS` | (unset) | On-chain receiving wallet; required with crypto flag |
| `BREAKBPM_STORE_URL` | (unset) | Squarespace URL for the 30 Day Pass card purchase; empty hides the card-store callout |
| `BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY` | `0.20` | Lucky Break Lifetime-upgrade odds, decimal `[0,1]` |
| `BREAKBPM_DAY_PASS_FIRST_DAY_CENTS` | `199` | Flexible crypto pass: first-day flat fee (cents) |
| `BREAKBPM_DAY_PASS_MID_RATE_CENTS` | `10` | Per-day add for days 2 through threshold |
| `BREAKBPM_DAY_PASS_MID_THRESHOLD` | `30` | Day the cheaper per-day bracket starts |
| `BREAKBPM_DAY_PASS_LONG_RATE_CENTS` | `3` | Per-day add beyond the threshold |
| `BREAKBPM_DAY_PASS_MAX_DAYS` | `365` | Longest purchasable run (days) |
| `BREAKBPM_INVITE_TRIAL_HOURS` | `24` | Free trial length (hours) for new users via invite links; min 1. Shipped to the client as `InviteCodeResult.trialLabel` (e.g. "24-hour") so AccountScreen invite copy never drifts |
| `BREAKBPM_FREE_PASS_MONTHLY_CAP` | `15` | Per-reward monthly stock for the landing-page giveaway |
| `BREAKBPM_MEETUP_SCENE_RADIUS_KM` | `100` | Outer "nearest scene" radius (km) for the meetup card's city-leaderboard link when no hall/city resolves within the normal 300 m / 50 km caps; min 1. Beyond it the 📍 label stays plain text |

## Operations & Admin

| Variable | Default | Description |
|---|---|---|
| `BREAKBPM_ADMIN_EMAILS` | (empty) | Comma-separated admin allowlist (effective Lifetime + code minting) |
| `BREAKBPM_USD_CAD_FALLBACK_RATE` | ~`1.37` | USD→CAD fallback when Bank of Canada FX lookup fails |
| `BREAKBPM_PROMO_QR_URL` | `https://breakbpm.com` | URL behind the splash-art QR easter egg (press-hold splash 8-ball 3s) |
| `BREAKBPM_BANNED_WORDS` | (empty) | Comma-separated blocklist for user-supplied free text (see below) |

### Banned-words matching (`wordFilter.ts`)

Case-insensitive matching combines three rules so glued/compound evasions are caught without flagging the app's own vocabulary:

1. **Short entries (≤3 chars**, e.g. `ass`/`jew`/`sex`) match only at **letter boundaries** — "ass"/"45ass56"/"ass!!" caught, but "passes"/"class"/"jewelry"/"Sussex"/"bass" spared (3-letter fragments are too common inside real words to match as substrings).
2. **Long entries (≥4 chars**, e.g. `cunt`/`fuck`/`pussy`) match **anywhere**, so a banned word glued onto other text ("cuntycounty", "fuckyou") is caught. *Trade-off:* a long entry also flags real words containing it (banning `cock` would flag "cocktail"/"peacock") — tune the list accordingly.
3. A whole letter-run composed **entirely** of banned words ("pussyass" = pussy+ass) is swapped wholesale, catching concatenations while sparing "assassin"/"bassist" (leftover letters mean not fully composed).

Inflections like "shitty" still need explicit entries. Empty/unset → no filtering.

**Three surfaces:**

- HUD ad copy is *cleaned* server-side — each blocked word swapped for a random friendly emoji, never rejected (`cleanBannedWords`).
- In-game player names are *cleaned* client-side at the SetupScreen input (`sanitizePlayerName` in `breakbpm/src/lib/wordFilter.ts`; list delivered via `GET /config`). On top of the blocklist it strips invisible/control/bidi chars, emoji-swaps URLs/markup, and caps names at 35 chars.
- Custom screen names are *rejected* with "choose another name" — emoji can't live in the public `/watch/{name}` URL handle (`findBannedWord`).

## HUD Ads (optional feature)

| Variable | Default | Description |
|---|---|---|
| `BREAKBPM_AD_BASE_DAILY_CENTS` | `690` | Base daily rate for user-bought HUD text ads |
| `BREAKBPM_AD_MIN_DAILY_CENTS` | `100` | Floor for effective daily ad rate |
| `BREAKBPM_AD_MAX_DAYS` | `369` | Maximum ad run length (days) |

## Client-visible runtime config

Values that the frontend must read at runtime (not build time) are served via `GET /config` and `GET /passes/plans`. Do not use `VITE_*` vars for these — they require an API server restart, not a frontend rebuild.