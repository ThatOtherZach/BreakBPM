---
name: Crypto day-pass slider (Add Days)
description: How the flexible 1–365 "Add Days" crypto pass works and the legacy-enum compat trap when editing it.
---

# Crypto "Add Days" pass

The Passes-screen crypto checkout sells a flexible pass via a 1–365 day slider
(`passKind:"days"` + `days`) instead of discrete Day/Month/Year cards. Lucky Break
and Lifetime stay as fixed-price crypto cards; Day/Month/Year are gone from the
crypto catalog (`CRYPTO_PASS_PLANS` = [lucky_break, lifetime]).

## Marginal-bracket pricing (must stay mirrored)
- Formula: day 1 = 199¢; days 2–30 add 10¢/day; days 31–365 add 3¢/day. Clamp+floor [1,365].
- Pinned values: 1→199, 7→259, 30→489, 31→492, 365→1494.
- **Server is authoritative** (`pricing.ts: computeDayPassPriceCents` + `DAY_PASS_PRICING`); the client mirror (`breakbpm/src/lib/dayPassPricing.ts`) only shows a live estimate. The server recomputes + FREEZES the amount at quote time.
- **Why:** drifting the two formulas would show a price the buyer never pays. Keep `dayPassPricing.test.ts` (client) and the server pricing in lockstep; bracket params ship to the client via `/passes/plans` → `CryptoCatalog.dayPass`.

## Verify maps days → a normal `day` pass
A verified days order grants a real `day` pass with `durationSeconds = passDays*86400` and `priceCents = order.priceCents` (overrides on `issuePassTx`/`grantPurchasedPassTx`). Sale ledger labels it "Day Pass (N days)".

## Legacy-enum compat trap — do NOT "tidy"
The OpenAPI `passKind` enums still include `day`/`month`/`year` even though `/crypto/quote` now rejects them (not in `CRYPTO_PASS_PLANS`).
- **Why:** verify must stay able to settle any pre-existing stored crypto orders that were quoted as day/month/year before this change.
- **How to apply:** don't remove those enum members to "match" the trimmed catalog — quote-time rejection already prevents new ones; removing them would break verify of legacy stored orders.

## Scope guardrail
This feature explicitly forbade admin-panel and `discount_codes` schema changes, and required Lucky Break + Lifetime + redeem/admin codes to stay unchanged. Keep future edits within that boundary unless the user reopens it.
