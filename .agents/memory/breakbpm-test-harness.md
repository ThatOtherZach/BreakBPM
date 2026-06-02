---
name: breakbpm test harness
description: How unit tests are wired into the breakbpm artifact and why a separate vitest config is needed.
---
# breakbpm test harness

The breakbpm artifact runs vitest via its own `vitest.config.ts`, NOT the main
`vite.config.ts`.

**Why:** `vite.config.ts` throws at load time unless `PORT` and `BASE_PATH`
env vars are set (they're injected by the workflow, absent in a plain shell).
Reusing it for tests would make `vitest run` crash. The separate config uses
the node environment and only re-declares the `@` → `src` alias.

**How to apply:** Run tests with `pnpm --filter @workspace/breakbpm run test`.
Test files live next to the code as `*.test.ts` and are already excluded from
`tsc` via the `**/*.test.ts` exclude in `tsconfig.json`, so typecheck ignores
them. Add new test files under `src/**/*.test.ts`.
