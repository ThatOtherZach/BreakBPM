---
name: Watch-profile background (stored-at-mint artwork)
description: How a /watch profile's splash artwork is chosen — stored on the redeem code at admin mint time, mapped via the pass sourceRef. NO hashing.
---

> **⚠️ CURRENTLY REGRESSED (verify before trusting this note).** As of the
> auto-earn rewrite (commit `a70908b`, "earn profile themes via game history"),
> `resolveUserProfileBackground` / `resolveUserProfileBackgrounds` no longer query
> `discount_codes.background_variant` at all — they only honour an explicit
> `profileTheme` override, then fall through to **auto-earn from game history**.
> The stored-card-variant lookup described below was dropped, so a redeemed card's
> artwork no longer shows on `auto`/NULL. This leaves 3 tests red in
> `games-profile.test.ts` (expecting the stored variant). Unclear whether the owner
> intended auto-earn to *replace* card artwork or whether card-variant should sit as
> a precedence step ABOVE auto-earn. Restore order is most likely: explicit theme →
> active card stored variant → auto-earn → null.

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
- Precedence: unpaid → null; explicit `profileTheme` (shark/pool-player/hustler) →
  that variant (a Lifetime holder's override, beats the stored card variant);
  `none` → null; `auto`/NULL → the stored card variant (or null).
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
