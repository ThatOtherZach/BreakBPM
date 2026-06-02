---
name: Paid-host gating uses tier, not hasActivePass
description: Which entitlement flag means "host has paid" — passes vs subscriptions.
---

When gating a feature on "the host has paid for it" (e.g. spectator watching),
gate on `entitlement.tier === 'pass'`, NOT `entitlement.hasActivePass`.

**Why:** `computeEntitlement` sets `hasActivePass` from one-time passes ONLY
(`getActivePasses().length > 0`); an active *subscription* does NOT set
`hasActivePass`. Both a pass and a subscription set `tier === 'pass'`. The
server's spectating gate (`hostSpectatingEnabled` = passes OR subscription) is
equivalent to `tier === 'pass'`. Gating the client on `hasActivePass` silently
hides paid features from subscription-only users — a real bug caught in review.

**How to apply:** For any "is this user/host on a paid plan" check, prefer
`tier === 'pass'`. Reserve `hasActivePass` for logic that specifically cares
about one-time passes vs subscriptions.
