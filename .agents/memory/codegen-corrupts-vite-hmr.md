---
name: Running API codegen during dev corrupts Vite HMR
description: Why frontend HMR starts failing after regenerating the OpenAPI client, and how to recover
---

# Orval codegen while the Vite dev server is running breaks HMR

Regenerating the API client (`pnpm --filter @workspace/api-spec run codegen`)
rewrites the generated files under `lib/api-client-react/src/generated/`. Orval
deletes-then-writes, so for a brief window the files don't exist. If the Vite
dev server is running, it can catch that gap and log:

`Pre-transform error: Failed to load url .../lib/api-client-react/src/generated/api.ts. Does the file exist?`

After that, Vite's module graph is left in a bad state and **HMR silently
fails** for downstream consumers (e.g. `GameScreen.tsx`) with repeated
`Failed to reload ... importing non-existent modules`. The browser keeps
running stale code, so edits appear to "not work" even though the source and
typecheck are correct.

**Why:** the failure is invisible — the app still loads (initial bundle was
fine), only HMR is dead, so symptoms look like "my change isn't showing."

**How to apply:** after running codegen (or any time HMR reload-failure errors
appear in the breakbpm web logs), restart the `artifacts/breakbpm: web`
workflow to rebuild Vite's module graph. Then hard-refresh the browser tab.
Trust the workflow logs / browser console over assuming your edit was wrong.
