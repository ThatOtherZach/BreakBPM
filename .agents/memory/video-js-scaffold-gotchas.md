---
name: video-js scaffold gotchas
description: Non-obvious build/typecheck traps when creating a video-js artifact in this monorepo
---

# video-js scaffold gotchas

## Missing DOM lib makes typecheck fail — and framer-motion errors are a red herring
The scaffold's per-artifact `tsconfig.json` (created by `createArtifact({artifactType:"video-js"})`) does NOT set `lib`, so it inherits `"lib": ["es2022"]` from `tsconfig.base.json` — no DOM. Running `tsc` then reports:
- `Cannot find name 'window'` / `Cannot find name 'document'` in the untouched scaffold files (`src/lib/video/hooks.ts`, `src/main.tsx`), AND
- a cascade of framer-motion `Variant` / `StyleKeyframesDefinition` type errors in the untouched `src/lib/video/animations.ts`.

**The framer-motion errors are a symptom, not a real bug.** Do NOT try to fix `animations.ts`. Add `"lib": ["esnext", "dom", "dom.iterable"]` to the artifact's `tsconfig.json` (match the sibling web artifact, e.g. `artifacts/breakbpm/tsconfig.json`) and ALL of the errors disappear together.

**Why:** without DOM types, framer-motion's type resolution degrades and misinfers its variant unions, producing misleading errors far from the real cause (the missing lib).

**How to apply:** right after a video-js `createArtifact`, add the DOM lib line to its tsconfig before running `pnpm --filter @workspace/<slug> run typecheck`.

## Google-font `@import url()` in src/index.css breaks the Tailwind v4 build
Putting `@import url('https://fonts.googleapis.com/...')` inside `src/index.css` (even directly under `@import "tailwindcss";`) fails the Vite build with `@import must precede all other statements`. The Tailwind v4 Vite plugin expands `@import "tailwindcss"` inline, so any later `@import` ends up after real CSS rules.

**How to apply:** load custom fonts via a `<link rel="stylesheet">` in `index.html` (the shell already preloads Google Fonts there) and remove the `@import url()` from CSS.
