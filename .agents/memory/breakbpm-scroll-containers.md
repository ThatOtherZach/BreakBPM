---
name: breakbpm scroll containers
description: Which element actually scrolls in the breakbpm frontend, for scroll-reset on route change.
---

# breakbpm scroll containers

The scroll context differs by page wrapper:
- Pages using `app-window app-window--page` scroll the **document/window** (the `--page` variant sets `.app-body { overflow: visible }` and the html/body scrolls).
- Other pages scroll the **`.app-body`** container (`overflow-y: auto`).

**Why:** client-side (wouter) route changes preserve the previous scroll position; landing a new screen "at the top" (e.g. the leaderboard "Who?" jump to `/watch/:name`) needs an explicit reset, and which element to reset depends on the wrapper of the screen you land on.

**How to apply:** on mount of the destination screen, reset both to be safe — `window.scrollTo(0,0)` AND `document.querySelector(".app-body")?.scrollTo?.(0,0)`. Skip in OBS overlay mode.
