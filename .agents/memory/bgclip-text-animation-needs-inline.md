---
name: background-clip:text animation needs inline, not flex
description: Why an animated rainbow text gradient sweeps when inline but sits static on a flex container
---

An animated `background-position` under `-webkit-background-clip: text` (the
rainbow-text technique used by `.rainbow-name` for admins and `.chaos-rainbow`
for the Stats AVG-BPM value) **does not repaint on a flex/grid container** in
Chrome/WebKit. The static gradient still shows clipped to the glyphs, but the
sweep animation appears frozen.

**Why:** with `display:flex`, the text runs live in child (anonymous) flex
items; the container's animated background isn't re-clipped to them per frame.
The admin name works only because it's applied to an *inline* `<span>`.

**How to apply:** apply the animated rainbow to an inline / `inline-block`
element, never a flex (or grid) box. `.stats-hero-value` is `display:flex`
(number + unit baseline gap), so `.chaos-rainbow` overrides it to
`inline-block` and replaces the lost flex `gap` with `margin-left` on
`.stats-hero-unit`. If you ever move this effect onto another flex element,
expect it to silently stop animating.
