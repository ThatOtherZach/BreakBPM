---
name: Panel flex-shrink clipping on mobile
description: Why .panel needs flex-shrink:0 — the app-body flex column compresses panels and overflow:hidden clips their content
---

`.app-body` is `display:flex; flex-direction:column; overflow-y:auto`. Its direct
children (the `.panel` section cards) default to `flex-shrink:1`, so when a
screen's total content is slightly taller than the mobile viewport the flex
column **compresses** panels below their natural height instead of letting the
body scroll. Because `.panel` also has `overflow:hidden`, the compressed panel
then **clips its own bottom content** (seen as the Close / Try again buttons on
the game-over Tag-Leaderboard dialog getting cut off at the bottom on a Pixel 9a).

Fix: `.panel { flex-shrink: 0; }` — panels keep their natural height and the
body scrolls instead.

**Why:** the clip is vertical (bottom), which points at flex-shrink in a column,
NOT a `white-space:nowrap` width overflow. Don't chase the button labels.

**How to apply:** any new direct child of `.app-body` that has its own
`overflow:hidden` and variable-height content needs `flex-shrink:0` (or be a
non-shrinking child) or it will clip when the page gets tall on small screens.
No panel relies on shrinking to scroll internally (they scroll via the body), so
`flex-shrink:0` on `.panel` is safe globally.
