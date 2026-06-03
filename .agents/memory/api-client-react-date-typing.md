---
name: api-client-react vs api-zod date typing
description: generated client types use string for date-time fields while api-zod types use Date — pick the right import on each side
---

The Orval-generated `@workspace/api-client-react` model types (api.schemas.ts) type every
`format: date-time` field as `string`, NOT `Date`. The `@workspace/api-zod` generated TS
interfaces type the same fields as `Date` (zod `useDates`).

**Why:** the React Query client does no date coercion; the server-side zod schemas do.
Mixing them causes `Type 'Date' is not assignable to type 'string'` (and vice-versa).

**How to apply:**
- In frontend (breakbpm) components, import response/post types from `@workspace/api-client-react`
  (not `@workspace/api-zod` — the latter is not even resolvable from the artifact tsconfig).
- When building a mutation body with a date-time field, send `someDate.toISOString()` (a string),
  not the Date object.
- When rendering a date-time value received from the client, it's a string — wrap in `new Date(...)`.
