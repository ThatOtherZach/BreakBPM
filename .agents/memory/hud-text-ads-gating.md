---
name: HUD text-ads gating & rotation
description: How non-paying-viewer detection and ad rotation are intentionally defined for the GameScreen HUD ads.
---

# HUD text ads (GameScreen)

Ads are shown to non-paying viewers and gated on `me.entitlement.tier !== 'pass'`.

**Why negative gating:** anonymous AND still-loading callers must SEE the ad, so
the gate is "not positively paid" rather than a positive non-paid signal. Don't
flip this to require a resolved non-paid entitlement or you suppress ads for the
largest audience (logged-out/first-paint users).

**Rotation = every third shot, in order across games.** Displayed index is
`(adBase + floor(shotLog.length / 3)) % ads.length`. `adBase` is read once from
`localStorage['breakbpm.adRotation']` on mount. The pointer is persisted
(advanced to `adBase + step + 1`) ONLY when `state.phase === 'ended'`, not on
every step.

**Why persist on end, not per step:** GameScreen is keyed by shareCode and
remounts on refresh too; if you persist the advanced pointer continuously, a
mid-game refresh re-reads an already-advanced base and the ad jumps forward by
the current step. Persisting only at game end keeps mid-game refreshes on the
same ad while still continuing the rotation in order for the next game.

**How to apply:** keep ad eligibility as `tier !== 'pass'`. Step granularity is
every 3 shots (`floor(shotLog.length/3)`). If you add ad surfaces, reuse the
same base-pointer + persist-on-end semantics.
