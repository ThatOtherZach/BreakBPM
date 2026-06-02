---
name: api-server test harness
description: How integration tests are wired into @workspace/api-server and the constraints they run under.
---
# api-server test harness

`@workspace/api-server` runs vitest via its own `vitest.config.ts` (node env,
`fileParallelism: false`). Tests are **integration tests against the real
Postgres** pointed to by `DATABASE_URL` — there is no mock DB. They seed
throw-away rows under random ids via `src/test/factories.ts` and clean up in an
`afterEach(cleanup)`.

**Why real DB, not mocks:** entitlement/subscription code calls the module-level
drizzle `db` with chained query builders; mocking that chain is brittle and
wouldn't exercise the actual SQL (active-window filters, the Lifetime
stop-renewal UPDATE). The shared dev DB already has the schema pushed.

**How to apply:**
- Run with `pnpm --filter @workspace/api-server run test`.
- For route tests, build a tiny express app mounting just the routers under
  `/api`, stub `req.log` with a noop, and `vi.mock("../lib/auth")` (only
  `getOrCreateUser` is used) + `vi.mock("../lib/paymentProvider")` (provide
  `paymentProvider` and `DEV_FREE_UPGRADE_ENABLED: true`). Use `vi.hoisted` for
  the mutable current-user / provider holder.
- `*.test.ts` is excluded from tsc via the tsconfig `exclude`, so typecheck
  ignores them. Cleanup deletes `discount_redemptions` explicitly (no FK to
  users); passes/subscriptions cascade on user delete.
