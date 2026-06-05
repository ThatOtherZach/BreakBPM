---
name: Crypto Lucky Break roll determinism & idempotency
description: How the on-chain Lucky Break purchase guarantees exactly one roll per payment and survives retries/races.
---

# Crypto Lucky Break: one roll per payment

The on-chain Lucky Break purchase reuses the pure draw engine (`computeLuckyBreakRoll`)
inside the crypto `/crypto/verify` grant transaction. Several non-obvious decisions
keep "exactly one roll per payment" true:

- **Seed the roll with the stable `crypto_orders.id`, NOT the tx hash or a fresh
  redemption id.** Because the engine is deterministic in its seed, re-verifying a
  settled order (resume, retry, double-click) reproduces the *same* outcome. Using a
  per-request value would let a re-verify draw a different tier.
  **Why:** the redeem-code path guarantees uniqueness via a server-assigned
  `redemptionId`; crypto has no such per-roll token, so the order id is the stable
  anchor.

- **Draw + pass grant + `crypto_orders.status='paid'` all happen in one tx**, with an
  in-tx dedup pre-check on `passes.sourceRef = txHash AND source='purchase'` that
  returns the existing pass + persisted roll without re-drawing.

- **The `23505` (unique-violation) catch must re-query the order, not blanket-fail.**
  If a concurrent verify of the *same* order wins the race, our tx rolls back cleanly
  (no double roll) but we must then return the already-granted pass + replayed roll
  (status `granted`), not a "transaction already used for another order" mismatch.
  Only a tx hash settling a *different* order is a true mismatch.
  **Why:** without the re-query, a harmless race surfaces a scary false error to a user
  who actually paid successfully.

- **Lifetime mutual exclusion applies on this path too:** `stopRenewingActiveSubscriptionsTx`
  in-tx + `stopRenewingStripeSubscriptions` out-of-tx, both skipped when `deduped`.

- **Record the paid amount, not the won tier's price:** `issuePassTx` takes an optional
  `priceCents` override; pass `order.priceCents` (the $4.99 Lucky Break price) so the
  issued Monthly/Lifetime pass doesn't claim it was sold at the tier's catalog price.

**How to apply:** any change to the crypto Lucky Break flow (or a similar
seeded-draw-on-payment feature) must preserve the stable seed, the single-tx draw, and
the re-query-on-23505 behavior, or retries/races will re-roll, double-grant, or show
false errors.
