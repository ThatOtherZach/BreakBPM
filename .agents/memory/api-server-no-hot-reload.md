---
name: API server has no hot reload
description: Why edits to artifacts/api-server source silently have no effect until the workflow is restarted.
---

The `artifacts/api-server: API Server` workflow runs `build && start` (esbuild bundle, then `node dist/index.mjs`). There is no watcher.

**The rule:** after editing any api-server source (routes, lib, etc.), you MUST `restart_workflow "artifacts/api-server: API Server"`. Until then the running process keeps serving the previously built bundle.

**Why:** this caused a real bug — a history-endpoint change that added a new field to the response compiled and typechecked fine, but the live server (started earlier) kept returning the old shape with the field missing, so the dependent UI silently rendered nothing. Nothing errored; the response was just stale.

**How to apply:** treat the api-server like a compiled service, not a hot-reloading dev server. The Vite frontend (`breakbpm`) DOES hot-reload, so frontend-only changes don't need a restart — but any server behavior change does. When a frontend feature backed by an API change "doesn't show up," suspect a stale server first (compare server start time in its log vs the source file mtime).
