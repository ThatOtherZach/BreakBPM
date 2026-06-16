---
name: Lucky Break disclosure lockstep
description: The Lucky Break roll's entropy source/window and its user-facing fairness copy must stay in sync, or the "provably fair" claim becomes false advertising.
---

The Lucky Break pass is sold on a **disclosed** fairness model: a disclosed Lifetime
probability (default 20%), draw SEEDED (not biased) by the last-30-days GLOBAL shot
activity hashed with the roll's redemption id.

**Odds are server-tunable, not a hardcoded constant.** The live probability comes from
`luckyBreakLifetimeProbability()` in `config.ts` (env `BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY`,
decimal [0,1], default 0.20). It flows DYNAMICALLY to the client: `/passes/plans` →
`pricing.ts` `luckyBreakInfo()`, and the per-roll result echoes `lifetimeProbability`.
So the *numeric* disclosure (reveal + plans) auto-stays in lockstep — `LuckyBreakReveal.tsx`
and `CryptoCheckout.tsx` render `result.lifetimeProbability`, not a literal. The pure
engine `luckyBreak.ts` stays env-free; call sites pass the value into `computeLuckyBreakRoll`.
Each roll snapshots `lifetimeProbabilityBps`, so historical rolls keep their original odds
when the env changes.

**Rule:** any change to what `gatherShotEntropy()` reads (global vs per-user, the
window length, what fields feed the hash), OR the odds *source/semantics*, MUST update the
STATIC prose in lockstep (the dynamic numbers self-sync, but these hardcode "20%" / "provably fair"):
- `CryptoCheckout.tsx` contextual Lucky Break notice (above the pay button, shown only when
  the Lucky Break pass is selected) — dynamic odds number, but hardcodes "provably-fair seeded draw" prose.
- `LuckyBreakReveal.tsx` seed note (the prose, not the dynamic number)
- `ABOUT.md` Lucky Break section
- README.md "Lucky Break — provably fair" section
- replit.md Product + Architecture "Lucky Break" entries

**Why:** the entropy is GLOBAL (all players), deliberately — it's a seed, not a stat.
An early draft of the UI/README said "your last 30 days of shots", which contradicted
the global source and would mislead users about how the draw works. The whole value
prop is accurate disclosure, so a copy/impl mismatch is a correctness bug, not a typo.

**How to apply:** treat the disclosure strings as part of the feature contract, like
the OpenAPI shape. When touching `luckyBreakEntropy.ts` or `luckyBreak.ts` odds/window
constants, grep for the copy locations listed above and reconcile them.
