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
| `BREAKBPM_INVITE_TRIAL_HOURS` | `24` | Free trial length (hours) for new users via invite links |
| `BREAKBPM_FREE_PASS_MONTHLY_CAP` | `15` | Per-reward monthly stock for the landing-page giveaway |

## Operations & Admin

| Variable | Default | Description |
|---|---|---|
| `BREAKBPM_ADMIN_EMAILS` | (empty) | Comma-separated admin allowlist (effective Lifetime + code minting) |
| `BREAKBPM_USD_CAD_FALLBACK_RATE` | ~`1.37` | USD→CAD fallback when Bank of Canada FX lookup fails |
| `BREAKBPM_PROMO_QR_URL` | `https://breakbpm.com` | URL behind the splash-art QR easter egg (press-hold splash 8-ball 3s) |
| `BREAKBPM_BANNED_WORDS` | (empty) | Comma-separated blocklist for user-supplied free text |

## HUD Ads (optional feature)

| Variable | Default | Description |
|---|---|---|
| `BREAKBPM_AD_BASE_DAILY_CENTS` | `690` | Base daily rate for user-bought HUD text ads |
| `BREAKBPM_AD_MIN_DAILY_CENTS` | `100` | Floor for effective daily ad rate |
| `BREAKBPM_AD_MAX_DAYS` | `369` | Maximum ad run length (days) |

## Client-visible runtime config

Values that the frontend must read at runtime (not build time) are served via `GET /config` and `GET /passes/plans`. Do not use `VITE_*` vars for these — they require an API server restart, not a frontend rebuild.