---
name: Lifetime <-> subscription mutual exclusion
description: Granting Lifetime must stop active subscriptions from renewing on EVERY grant path, not just purchase.
---

# Lifetime grant must stop subscription renewal on all paths

When a Lifetime pass is issued, any active recurring subscription must be
flagged to stop renewing (`stopRenewingActiveSubscriptionsTx`) inside the **same
transaction** as the pass insert.

**Why:** Lifetime is the terminal entitlement — a user paying once for forever
should not keep getting charged a subscription. A code review caught that only
the purchase-verify and dev-grant paths did this; the discount-code redeem path
issued Lifetime without stopping the subscription, leaving it renewing.

**How to apply:** There are multiple ways a Lifetime pass can be issued —
purchase verify, dev/admin grant, and discount-code redeem. Any new Lifetime
grant path must also call the stop-renewing helper. Grep for every `issuePassTx`
call site (and any future ones) and confirm each checks `issued.kind ===
"lifetime"`. Conversely, subscribe/checkout/dev-activate must refuse when a
Lifetime pass is already held.
