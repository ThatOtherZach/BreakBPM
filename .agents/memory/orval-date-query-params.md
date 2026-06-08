---
name: Orval date-time query params are zod.date()
description: Generated query-param schemas reject ISO strings; coerce before safeParse.
---

For an OpenAPI query param `schema: { type: string, format: date-time }`, the
Orval/zod codegen emits `zod.date()` (NOT `zod.coerce.date()`) in the
`*QueryParams` schema. Express query values are always strings, so
`Schema.safeParse(req.query)` FAILS for those params and the route returns 400 —
including for everything the frontend sends.

**Fix:** coerce the relevant query strings to `Date` (or undefined) before
`safeParse`, e.g. `from: typeof q.from === "string" && q.from ? new Date(q.from) : undefined`.
`zod.date()` still rejects `new Date("garbage")` (Invalid Date), so validation is
preserved. Numeric params are fine — those generate `zod.coerce.number()`.

**How to apply:** whenever a route validates query params with a generated
`*QueryParams` schema that has a date-time field, pre-coerce it; don't assume the
schema coerces strings the way path/body schemas might.
