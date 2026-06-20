---
name: HUD text-ads gating & rotation
description: How non-paying-viewer detection and per-game ad rotation are intentionally defined for the GameScreen HUD ads.
---

# HUD text ads (GameScreen)

Ads are shown to non-paying viewers and gated on `me.entitlement.tier !== 'pass'`.

**Why negative gating:** anonymous AND still-loading callers must SEE the ad, so
the gate is "not positively paid" rather than a positive non-paid signal. Don't
flip this to require a resolved non-paid entitlement or you suppress ads for the
largest audience (logged-out/first-paint users).

**Rotation = once per game:** a `localStorage` pointer (`breakbpm.adRotation`)
picks one ad on GameScreen mount and advances by one. GameScreen is keyed by
`shareCode` in App.tsx, so a new game / rematch remounts and advances exactly
once — the ad is stable within a game and cycles in order across games.

**How to apply:** keep ad eligibility as `tier !== 'pass'`. If you add more
ad surfaces, reuse the same pointer semantics (advance once per game-mount),
not per-render or per-shot.
