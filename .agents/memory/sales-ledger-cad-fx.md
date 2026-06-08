---
name: Sales ledger CAD/FX freeze
description: Why the sale_events ledger stores CAD + a frozen Bank-of-Canada USD→CAD rate, and the invariants that keep it auditable.
---

# Sales ledger reports CAD, but all pricing is USD

All BreakBPM prices are USD (Stripe `currency=usd`, USDC≈USD, ETH off an ETH/USD
feed; the `*_PRICES_CENTS` constants are USD cents). The admin sales ledger must
report **true CAD** for Canadian (GST/PST) tax, so every `sale_events` row freezes
a USD→CAD conversion at sale time.

**Why:** A CRA-defensible ledger needs the exact rate used on the sale date, frozen
on the row — not a live/recomputed rate. Recomputing later would silently rewrite
historical tax. The Bank of Canada Valet API (`FXUSDCAD`) is free and CRA-accepted.

**How to apply:**
- Fetch the rate **pre-tx** (`fx.ts` `getUsdToCadRate()` today / `getUsdToCadRateForDate()`
  historical) and pass `fx: UsdCadRate` *into* `recordSaleEventTx` — never fetch inside a tx.
- `recordSaleEventTx`'s `grossCents` input is the **USD source**. It converts to CAD,
  computes GST/PST on the **CAD** gross, and stores BOTH: CAD (`grossCents`/`gst`/`pst`/`net`)
  and audit (`sourceGrossCents`, `sourceCurrency`, `fxRateMicros`, `fxRateDate`, `fxSource`).
- Rates are scaled ×1e6 (micros); `convertUsdToCad` is pure: `round(usdCents*rateMicros/1e6)`.
- `fx.ts` **never throws** — fallback chain last-good → env `BREAKBPM_USD_CAD_FALLBACK_RATE`
  → hardcoded ~1.37. A network blip must not block a sale.
- Every sale path must thread fx: `crypto.ts` (Lucky Break + fixed), `passes.ts`
  (redeem + verify), `stripeReconcile.ts` (purchase + renewal); backfill uses the
  per-row historical rate so old rows get their own date's rate.
- Route tests MUST `vi.mock("../lib/fx")` with a fixed non-unity rate (e.g. 1.35) —
  otherwise they hit the BoC network and are non-deterministic. Assert
  `grossCents === round(sourceGrossCents * rate)` to prove the conversion is applied.
- BoC JSON shape: `observations[].FXUSDCAD.v` is a decimal string (e.g. "1.3924").
