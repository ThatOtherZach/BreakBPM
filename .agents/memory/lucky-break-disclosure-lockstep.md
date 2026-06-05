---
name: Lucky Break disclosure lockstep
description: The Lucky Break roll's entropy source/window and its user-facing fairness copy must stay in sync, or the "provably fair" claim becomes false advertising.
---

The Lucky Break pass is sold on a **disclosed** fairness model: fixed 20% Lifetime
odds, draw SEEDED (not biased) by the last-30-days GLOBAL shot activity hashed with
the roll's redemption id.

**Rule:** any change to what `gatherShotEntropy()` reads (global vs per-user, the
window length, what fields feed the hash) MUST update the fairness copy in lockstep:
- `PassesScreen.tsx` hero "Fair play" paragraph
- `LuckyBreakReveal.tsx` seed note
- README.md "Lucky Break — provably fair" section
- replit.md Product + Architecture "Lucky Break" entries

**Why:** the entropy is GLOBAL (all players), deliberately — it's a seed, not a stat.
An early draft of the UI/README said "your last 30 days of shots", which contradicted
the global source and would mislead users about how the draw works. The whole value
prop is accurate disclosure, so a copy/impl mismatch is a correctness bug, not a typo.

**How to apply:** treat the disclosure strings as part of the feature contract, like
the OpenAPI shape. When touching `luckyBreakEntropy.ts` or `luckyBreak.ts` odds/window
constants, grep for the four copy locations above and reconcile them.
