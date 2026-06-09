---
name: background-clip:text animation needs inline, not flex
description: Why an animated rainbow text gradient sweeps when inline but sits static (or fails to render) on a flex container
---

An animated `background-position` under `-webkit-background-clip: text` (the
rainbow-text technique used by `.rainbow-name` for admin names and reused for
the Stats AVG-BPM value) **misbehaves when applied to a flex/grid container** in
Chrome/WebKit: the sweep doesn't repaint and the clipped glyphs can fail to
render at all.

**Why:** with `display:flex`, the element's text runs live in child (anonymous)
flex items, so the container's animated background isn't re-clipped to them. The
admin name works only because `.rainbow-name` is applied to an inline `<span>`.

**How to apply:** apply the animated rainbow to an inline element, never the
flex box itself. `.stats-hero-value` is `display:flex` (number + unit baseline
gap), so the chaos-winner flourish does NOT style that container — it wraps just
the number in an inline `<span className="rainbow-name">` (the same proven admin
class), which becomes a normal flex item whose own text clips/animates fine. The
only extra CSS is `.stats-hero-value .rainbow-name { text-shadow: none }` to kill
the value box's inherited green glow. Don't recreate a parallel `.chaos-rainbow`
gradient rule on the flex value — it silently won't animate.
