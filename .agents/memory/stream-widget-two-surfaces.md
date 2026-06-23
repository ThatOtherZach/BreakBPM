---
name: Share image & OBS overlay — each snapshots its own real HUD in the shared W98Frame
description: The end-game Share Card PNG and the OBS overlay both snapshot the REAL in-game HUD wrapped in one shared W98Frame chrome — there is deliberately NO separate mock widget. Why, and the gotchas.
---

# Share image & OBS overlay: real HUD, one shared frame

Two surfaces render a Windows-98-framed pool HUD and snapshot/paint it:
1. end-game **Share Card** in `GameScreen` — the host's REAL live HUD,
   rendered offscreen and snapshotted to a PNG via `html-to-image` (`toBlob`,
   `streamWidgetImage.ts` / `nodeToPngBlob`), native share sheet + download
   fallback;
2. the live **OBS overlay** (`/watch/:name?obs=1`) in `JoinedGameScreen`.

**Key decision — do NOT reintroduce a separate mock widget.** There used to be a
standalone `StreamWidget` + pure `buildStreamWidgetData` builder feeding the
share PNG. It DRIFTED from the real HUD (a parallel re-implementation nobody
kept in sync). It was deleted. Each surface now wraps ITS OWN real HUD JSX in
the shared `W98Frame` (named export of `ObsOverlay.tsx`) — so the image can
never diverge from what players actually see. The only shared pieces are
`W98Frame` (chrome), the `.w98-*` CSS namespace, and the snapshot helper.
**Why:** a second drawing/data codebase is the thing that rots. Keep new
share/overlay surfaces on the real component + `W98Frame`, never a new mock.

**`forImage` gating:** `GameScreen`'s HUD lives in
`renderHudPanel(forImage: boolean)` — `false` for the live screen, `true` for
the snapshot. `forImage` drops interactive / non-deterministic bits from the
image: the rotating text ad, the copy-code button, and the press-hold join-QR
reveal. Add any new interactive/animated HUD element behind `!forImage`.

**Rainbow on the W98Frame title:** the frame's `handle` is the screen name, but
the rainbow flag must track HOST identity (slot 0), mirroring the OBS overlay's
`rainbow={n(hostName)}`. In `GameScreen` use
`rainbowBySlot.get(0) ?? isRainbowName(state.players[0]?.name)`, NOT
`isRainbowName(watchName)` — screenName can differ from the host's displayName.

**Why `.w98-*` scoping:** the rest of the app keeps its CRT look; the Win98
chrome is intentionally confined to the `.w98-` class namespace in `index.css`
so it never leaks into CRT surfaces. Don't introduce un-namespaced Win98 rules.

**Gotchas:**
- Offscreen node must be positioned off-screen (`position:fixed; left:-10000;
  opacity:0`), NOT `display:none`, or html-to-image can't measure/paint it.
- Preload VT323 before `toBlob` (`ensureWidgetFonts`, mirrors `ensureCardFonts`).
- `streamWidget.ts` is now trimmed to just `WIDGET_BALL_COLORS` (WatchByNameScreen
  demo chips). The `redeemCard.ts` canvas approach is unrelated — this path is
  React-snapshot, not canvas-redraw.
- Benign, PRE-EXISTING console noise: html-to-image logs a `SecurityError`
  trying to read `cssRules` from the cross-origin Google Fonts `<link>` in
  `index.html`. It's caught internally; the snapshot still completes. Not a bug,
  not introduced by the real-HUD refactor — don't chase it.
