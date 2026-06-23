---
name: Stream/share widget — one widget, two surfaces
description: The Win98 HUD/result widget is a single React component reused by the end-game share image AND the OBS overlay; how it differs from the canvas redeem card.
---

# Stream widget: one component, two surfaces

The Windows-98 styled HUD/result widget (`StreamWidget` + pure builder
`buildStreamWidgetData` + `streamWidgetImage`) is ONE React component rendered on
two surfaces:
1. end-game **Share** in GameScreen — rendered offscreen, snapshotted to a PNG
   with `html-to-image` (`toBlob`), handed to the native share sheet with a
   download fallback;
2. the live **OBS overlay** (`/watch/:name?obs=1`) in JoinedGameScreen.

**Why React-snapshot, not canvas-redraw:** the older redeem *card* image
(`redeemCard.ts`) hand-draws on a `<canvas>`. This widget deliberately does NOT
— it renders real DOM/React once and snapshots it, so the share PNG is
pixel-identical to the live overlay and there's no second drawing codebase to
keep in sync. Keep new share/overlay surfaces on this builder, not a new canvas.

**Why `.w98-*` scoping:** the rest of the app keeps its CRT look; the Win98
chrome is intentionally confined to the `.w98-` class namespace in `index.css`
so it never leaks into the CRT surfaces. Don't introduce un-namespaced Win98
rules.

**How to apply:** both surfaces must feed the same `buildStreamWidgetData`
(pure, no hooks) so figures match; for fonts in the snapshot, preload VT323
before `toBlob` (mirrors `ensureCardFonts`). Offscreen node must be positioned
off-screen (not `display:none`) or html-to-image can't measure/paint it.
