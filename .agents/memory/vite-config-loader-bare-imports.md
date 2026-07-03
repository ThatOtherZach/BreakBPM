---
name: Vite config loader can't resolve workspace package bare imports
description: Importing a source module into vite.config.ts that transitively pulls in a @workspace/* package breaks the config loader with ERR_MODULE_NOT_FOUND.
---

Vite's config loader (esbuild) bundles *relative* imports used inside `vite.config.ts`, but leaves bare package specifiers external and resolves them with Node's native ESM loader. Workspace libs (e.g. `@workspace/api-client-react`) that ship extensionless relative imports in their own source fail to resolve when reached this way, crashing `vite.config.ts` entirely (`ERR_MODULE_NOT_FOUND`) — even though the same import works fine from app source compiled by Vite/esbuild proper.

**Why:** this only bites `vite.config.ts` (and other files loaded by Vite's own config bundler), not regular app code, because the config loader's resolution algorithm differs from the dev/build pipeline's.

**How to apply:** before importing any `src/lib/*` helper into `vite.config.ts` (e.g. for build-time prerender logic), check what it transitively imports. If it reaches a `@workspace/*` package, don't import it directly — duplicate the small piece of data/logic you need as a local const/function inside `vite.config.ts` instead. This came up extending the build-time prerender pipeline (home + per-hall static pages) when a payment-label helper transitively pulled in `@workspace/api-client-react`.
