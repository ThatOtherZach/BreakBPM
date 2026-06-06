---
name: Public profile reuses /stats shaping
description: How the Watch-page player profile gets a StatsResult and why its flags are fixed.
---

The `/games/profile` route (public, view-only, `/watch/:name` with no live game) returns a full `StatsResult` under `stats`, in addition to the legacy all-time summary fields. This lets `PlayerProfileScreen` render the same shared `StatsHero` CRT readout as the owner's Stats page.

**Rule:** the `stats` object must be shaped exactly like the `/stats` route's response (spread `resolveStats(...).core` minus `computedAt`, then re-add ISO `computedAt` + tier/scope/window/appliedScope/appliedWindow/canChooseWindow/canToggleGlobal/canRefresh/cached). It is always `personal` scope + `24h` window, `tier:"public"`, and all capability flags fixed to `false`.

**Why:** the hero is a generic `StatsResult` consumer; diverging the shape (or letting the two routes drift) silently breaks the shared component or the `PublicProfileResult.stats` Zod parse. The fixed flags are intentional — this is a public, non-interactive readout, not the owner's selectable Stats page.

**How to apply:** any change to the `/stats` StatsResult envelope (new flag, renamed field) must be mirrored in the `/games/profile` shaping, and the OpenAPI `PublicProfileResult.stats` is `oneOf[StatsResult, null]` (nullable when the player isn't found).
