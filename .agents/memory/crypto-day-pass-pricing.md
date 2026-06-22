---
name: Crypto day-pass pricing is env-configurable
description: The flexible 1–365 day crypto pass uses marginal-bracket pricing whose params are env vars; the same params must reach both the server quote and the client estimate or they drift.
---

# Crypto "Purchase Days of Access" pricing — env-configurable, must stay mirrored

The flexible crypto day pass (1–365 days) is priced by marginal brackets in pure `computeDayPassPriceCents(days, params)` (`api-server/src/lib/pricing.ts`; a client mirror lives at `breakbpm/src/lib/dayPassPricing.ts`). The bracket params are env vars resolved by `config.ts` `dayPassPricing()` (`BREAKBPM_DAY_PASS_FIRST_DAY_CENTS` / `_MID_RATE_CENTS` / `_MID_THRESHOLD` / `_LONG_RATE_CENTS` / `_MAX_DAYS`; `minDays` fixed at 1). The static `DAY_PASS_PRICING` const is only the default fallback.

**Why:** the client renders a live slider estimate and the server freezes the authoritative quote — if they read different params they drift and the server quote rejects the client's number. The bridge is `GET /passes/plans`, which returns `dayPass: dayPassPricing()`; the client computes its estimate with `computeDayPassPriceCents(days, catalog.dayPass)`. So `/crypto/quote` MUST also call `dayPassPricing()` (NOT the static default) for validation bounds + price, or an env override silently takes effect on only one side.

**How to apply:** when touching day-pass pricing, (1) pass `dayPassPricing()` into both `/crypto/quote` (validation bounds + `computeDayPassPriceCents`) and the `/passes/plans` `dayPass` field; (2) keep the client clamp in `CryptoCheckout` (an effect clamping `days` to `catalog.dayPass.min/maxDays`) so a low custom `_MAX_DAYS` can't leave the default slider value out of range; (3) api-server has no hot reload — restart its workflow after editing.
