---
name: Free/comp code redemptions must book $0 in the sales ledger
description: Why a free giveaway code redemption has to be valued as a comp, keyed on issuerKind, and how the atomic pool draw stays oversell-safe.
---

# Free-claim comp ledger + oversell-safe pool draw

**Rule:** Any code redemption whose `discount_codes.issuerKind === 'claim'` (the landing-page free-pass giveaway) MUST be valued as a `$0` comp (`isComp:true`, `grossCents:0`, `sourceGrossCents:0`) in `sale_events`, **including the Lucky Break draw**. The valuation seam (`valuationForCodeRedemption`) takes `issuerKind` and branches on it; the redeem core threads `discount.issuerKind` through.

**Why:** A Lucky Break redemption normally books the $4.99 Lucky Break price as paid revenue. A *free* Lucky Break (won via the giveaway) would otherwise record $4.99 of phantom CAD revenue and pollute the CRA tax ledger. The carve-out is the only thing that distinguishes "user paid $4.99 to roll" from "user claimed a free roll".

**How to apply:** Whenever you add a new code source/issuerKind or a new redemption path, decide its ledger valuation explicitly in `valuationForCodeRedemption` — do not assume the code's grant tier implies its price. Comp-ness is a property of *how the code was issued*, not what it grants.

**Oversell-safe pool draw (same file, freePassClaims.ts):** Stock lives in `free_pass_claim_pools` PK `(periodKey, rewardKind)`. The draw is the guarded atomic `UPDATE ... SET claimed_count = claimed_count + 1 WHERE claimed_count < cap RETURNING claimed_count` (same pattern as the discount-code cap claim) — the `RETURNING` row is null when full, which is the only oversell gate. Three independent double-grant guards stack: (1) active-pass pre-check, (2) the atomic decrement, (3) `UNIQUE(user_id)` on `free_pass_claims` (one claim per account ever, the in-tx race backstop). The whole claim — pool draw, code mint, claim insert, pass issue, redemption+audit rows, ledger event — runs in ONE `db.transaction` so an expected race throws and rolls back every write.

**Accepted edge:** a same-user race between `/passes/claim` and another grant path (manual `/passes/redeem` or purchase) can let both pass the active-pass pre-check and leave the user with two overlapping passes. Benign — both are legitimate grants and the free claim is still one-per-account. Not worth extra locking.
