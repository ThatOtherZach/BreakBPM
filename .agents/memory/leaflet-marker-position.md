---
name: Leaflet marker divIcon classes must stay position:absolute
description: Why custom Leaflet marker classes (e.g. .fpp-venue-pin) must not set position:relative — it silently breaks map pin placement.
---

# Leaflet marker divIcon classes must keep `position: absolute`

leaflet.css positions every marker icon with `.leaflet-marker-icon { position: absolute; left:0; top:0 }` and then moves it via a `transform: translate3d(...)`. A custom `className` you pass to `L.divIcon` is applied to that same element.

If your custom class sets `position: relative` (or anything non-absolute), the two single-class selectors **tie on specificity (0,1,0)** and the app's `index.css` wins by **source order** (it loads after leaflet.css). The marker then stays in normal flow inside the marker pane and still gets Leaflet's transform on top, so pins **drift progressively from the tiles** (worse toward the map edges) — looked like venue pins floating out in the ocean even though the stored GPS coords were correct.

**Rule:** a custom Leaflet marker class must keep `position: absolute` (match Leaflet), never `relative`. Setting it explicitly to `absolute` is better than omitting `position` because it stays correct even if CSS bundling/import order changes.

**Badge anchoring:** to anchor an absolutely-positioned child badge on the pin, you don't need `position: relative` — an absolutely-positioned root is already a containing block, and any `filter:` on the root (e.g. `drop-shadow`) also establishes one.

**Why:** same root pattern as the visual-editor color override note — in this repo, `index.css` rules win source-order ties against library CSS. **How to apply:** when adding any new map marker class, set `position: absolute`; never reuse a marker class for static (in-flow) UI.
