---
name: Crypto manual-order claim safety
description: Invariants that keep the wallet-less (payer-less) crypto checkout from cross-claiming or replaying payments.
---

# Crypto manual-order claim safety

Manual (payer-less) crypto orders are claimed by a UNIQUE exact amount, not by a
bound payer. Two invariants must hold together or a payment can be cross-claimed
or replayed:

1. **Unique amount must be assigned ATOMICALLY.** A read-then-insert pre-check is
   a TOCTOU race — two concurrent quotes can pick the same amount. Enforce it with
   the partial unique index on `(receiving_address, asset, expected_amount) WHERE
   payer_address IS NULL AND status IN ('pending','paid')` and insert via
   `INSERT ... ON CONFLICT DO NOTHING` + retry with a fresh random tail; fail the
   quote cleanly if attempts exhaust.
   **Why:** index is scoped to LIVE manual orders so expired/failed amounts can be
   recycled — which is exactly what makes invariant 2 necessary.

2. **Replay lower-bound lives on the COMMON verifier path.** Because amounts are
   recycled, a transfer that landed BEFORE an order was created must never settle
   it. Enforce `manual && blockTimestamp > 0 && blockTimestamp*1000 < createdAt`
   → reject, AFTER verifyPayment and BEFORE the grant. Do NOT rely on the
   `findIncomingUsdcTx` age-bounded scan alone — that only covers auto-detect; a
   pasted tx hash bypasses it. The age-bounded scan is convenience; the security
   check is the verify-route guard.

**How to apply:** any change to the manual quote/verify flow (new asset, new
claim path, changed status lifecycle) must preserve both — atomic unique-amount
reservation and the verify-path lower-bound timestamp check. Connected
(payer-bound) orders are outside both (payer match + overpay `>=` instead).
