---
name: Visual editor color edits lose to hand-written CSS
description: Why visual-editor color/style tweaks silently don't apply in breakbpm, and where to fix them instead
---

# Visual editor Tailwind classes lose to component CSS

The visual editor records color/style tweaks by appending Tailwind arbitrary
utilities (e.g. `text-[#00ff41]`, `border-t-[#00ff41]`) directly onto the JSX
element's `className`. The breakbpm HUD is styled by hand-written rules in
`artifacts/breakbpm/src/index.css` (`.hud-bpm-label`, `.hud-bpm-sub`,
`.hud-meta-label`, `.hud-mode-players`, etc.).

**The trap:** a Tailwind utility class and a custom `.hud-*` class have the
same specificity (single class = 0,1,0). When specificity ties, source order
decides — and the custom CSS is emitted after Tailwind's utilities, so the
custom rule wins. Result: the visual edit appears in the markup but the color
on screen never changes.

**Why:** users report "I changed it to X but it still shows the old color."
It's not a caching or build problem — it's a CSS cascade order tie.

**How to apply:** for breakbpm HUD/styling color changes, edit the CSS rule in
`index.css` (the source of truth), not inline Tailwind classes. Also strip any
dead `text-[...]`/`border-*-[...]` utilities the visual editor injected — the
`border-color` ones render nothing anyway (no width/style set) and are noise.
