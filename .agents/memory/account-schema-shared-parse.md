---
name: Account schema shared by /auth/me + both PATCH handlers
description: Adding a required field to the shared OpenAPI Account schema silently breaks PATCH response .parse() calls; typecheck won't catch it.
---

The OpenAPI `Account` schema (`lib/api-spec/openapi.yaml`) is `$ref`'d by THREE
responses: `GET /auth/me` (nested under `account`), `PATCH /auth/screen-name`
(`UpdateScreenNameResponse`), and `PATCH /auth/profile-theme`
(`UpdateProfileThemeResponse`). All three live in `routes/auth.ts` and build the
account object by hand and call `<Schema>.parse({...})`.

**Rule:** any field added as **required** to `Account` must be populated in ALL
THREE handlers, or that handler's `.parse()` throws at runtime → HTTP 500.

**Why:** `ZodSchema.parse(x)` takes `unknown`, so a hand-built object literal
missing a newly-required field is NOT a TypeScript error — `pnpm run typecheck`
stays green. The failure only surfaces at runtime (a route test catches it). A
required-field add to a shared schema is therefore a silent runtime trap, not a
compile error.

**How to apply:** after adding a required field to a shared response schema, grep
`#/components/schemas/<Schema>` in the spec to find every call site, then make
sure each `.parse({...})` includes the new field. Prefer running the full route
vitest suite (not just typecheck) as the acceptance gate. If a field is genuinely
only available on one endpoint, model it optional instead of required.
