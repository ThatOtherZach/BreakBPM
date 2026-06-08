---
name: Stripe sale dual-path recording
description: Why Stripe pass sales must be recorded in BOTH the verify route and the webhook reconcile.
---

A Stripe one-time pass purchase is granted idempotently by TWO paths that race:
the synchronous `/passes/verify` (called by the client after checkout redirect)
and the async `checkout.session.completed` webhook. Both call
`grantPurchasedPassTx` keyed on the same provider ref (the payment intent —
`verifyAndGrant` returns `providerRef = session.payment_intent`, the webhook uses
`payment_intent ?? session.id`).

**Rule:** the `recordSaleEventTx` call must live in BOTH paths, inside the grant
transaction, gated on `!grant.deduped`, with `providerRef = <payment intent>`.

**Why:** if only the webhook records (gated on `!deduped`) and verify runs first,
verify grants the pass (deduped=false) but writes no sale; the later webhook is
then deduped=true and skips recording — leaving ZERO ledger rows for a real paid
sale. Recording in whichever path wins the grant, plus ON CONFLICT(provider_ref)
DO NOTHING on the other, yields exactly one row.

**How to apply:** any new pass-issuance path (or a change to which path "wins")
must record its sale in the same transaction as the grant, keyed on the same
stable provider ref the other paths use.
