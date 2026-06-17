---
name: Watch-profile background derivation rule
description: How a /watch profile's splash artwork is chosen — card-only, default none, headline-pass driven.
---

A `/watch/<name>` profile's splash artwork (shark / pool-player / hustler) is
**only ever assigned by a redeem card**. The DB-aware resolver
(`resolveUserProfileBackground` in `artifacts/api-server/src/lib/`) wraps the pure
`resolveProfileBackground` picker.

**Rule:**
- Default is **none** (plain). `profileTheme` NULL/"auto" with no derivation key → plain.
- Only an active **`discount_code`-sourced** pass carries a redeem card; its
  `sourceRef` (the code) is the djb2 derivation key, so the artwork matches the
  printed card. Passes with no card — crypto, `grant`, admin effective-Lifetime —
  derive nothing → plain.
- A stored explicit `profileTheme` (shark/pool-player/hustler/none) always wins —
  this is how a Lifetime holder selects/overrides their theme.
- **Any active redeemed-card pass applies its artwork** — do NOT gate on a
  "headline / longest pass". A user with a card pass AND a longer non-card/lifetime
  pass still shows the card's artwork (most-recently-redeemed card wins if several).
  An earlier "headline pass wins" rule was wrong and contradicted the owner's
  intent ("if they redeemed a pass with artwork, it gets applied"); `games-profile.test.ts`
  now guards the corrected behavior.

**Why:** the artwork exists to mirror the physical/redeem card, so assigning it to
non-card holders is meaningless; the owner wanted the default to be plain.

**Lockstep:** server djb2 (`profileBackground.ts`) and client mirror
(`backgroundVariants.ts`) must agree on variant order + hash; mirrored mapping
tests enforce it — keep them whenever variant order or hash changes.
