---
name: Watch-profile background (stored-at-mint artwork)
description: How a /watch profile's splash artwork is chosen — stored on the redeem code at admin mint time, mapped via the pass sourceRef. NO hashing.
---

A `/watch/<name>` profile's splash artwork (shark / pool-player / hustler) is
**chosen and stored when an admin mints the redeem card**, never derived from the
code string. The DB-aware resolver (`resolveUserProfileBackground` in
`artifacts/api-server/src/lib/`) wraps the pure `resolveProfileBackground` picker.

**Rule:**
- Artwork is stored on `discount_codes.background_variant` at mint time, driven by
  the admin "Include splash artwork (random)" checkbox (default on →
  `randomBackgroundVariant()`; off → null). A redeemed card pass keeps that code in
  `sourceRef`, so the resolver maps the player's active `discount_code`-sourced pass
  back to the code's stored variant. Passes with no card — crypto, `grant`, admin
  effective-Lifetime — and cards minted without artwork (null) → plain.
- Precedence (paid): explicit `profileTheme` (shark/pool-player/hustler) → that
  variant (Lifetime override, beats the stored card variant); `none` → null
  (opt-out, beats card + earned); `auto`/NULL/`rainbow` → stored card variant,
  else fall back to an auto-earned theme, else null. Unpaid (free/account/expired)
  → only the auto-earned theme (`profileTheme` ignored), else null.
- **Auto-earn** = a theme earned from recent game-history majority
  (`computeAutoEarnedVariantFromGames`). It sits BELOW card artwork: it only fills
  in when a paid player has no card, or for unpaid players. Both DB resolvers
  (single + batched) delegate to the pure `resolveProfileBackground` so this order
  stays identical; the card lookup once regressed (auto-earn rewrite dropped the
  `discount_codes` query) — `profileBackground.test.ts` + `games-profile.test.ts`
  now guard card-vs-earned precedence.
- **Any active redeemed-card pass applies its stored artwork** — do NOT gate on a
  "headline / longest pass". Most-recently-redeemed card with a non-null variant
  wins when several. `games-profile.test.ts` guards this.

**Why:** the owner explicitly killed the old read-time djb2 hashing of the code
(it felt arbitrary/unpredictable); artwork must be a deliberate choice baked into
the card so the printed card and the redeemer's profile always match exactly. Do
NOT re-introduce hash/auto-derive-from-key.

**Lockstep:** `BACKGROUND_VARIANTS` order must match between server
`profileBackground.ts` and client `backgroundVariants.ts` so the stored value maps
to the same artwork on both sides. The client card (`redeemCard.ts loadCardBackground`)
takes the stored variant (nullable → plain dark card).
