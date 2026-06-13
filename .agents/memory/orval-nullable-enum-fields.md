---
name: Orval nullable-enum fields
description: How to declare a nullable enum property in openapi.yaml so codegen produces the right zod + TS for this repo.
---

To add a nullable, optional enum property to a schema, write it in
`lib/api-spec/openapi.yaml` as a JSON-Schema-3.1 nullable type **plus** a
string-only `enum` (do NOT put `null` inside the `enum` list):

```yaml
paymentType:
  type: ["string", "null"]
  enum: ["free", "per_game", "hourly"]
```

**Why:** Orval then generates exactly what we want:
- api-zod: `zod.enum(['free','per_game','hourly']).nullish()` — accepts the
  tokens, `null`, and `undefined`; rejects unknown strings. (For a *required*
  field, drop `null` from `type` to get `.enum(...)` without `.nullish()`.)
- api-client-react: a named `XPaymentType` const-object + union type
  (`... | null`), so the frontend gets real literal types, not bare `string`.

Putting `null` literally inside `enum` risks orval emitting an invalid
`zod.enum([..., null])` (z.enum only takes string literals). The nullable
**type** is what drives `.nullish()`.

**How to apply:** Use this shape for any optional+nullable enum column. Server
response `.parse()` then never throws on a null DB value, and `?? null` on
insert/update is enough. Always run
`pnpm --filter @workspace/api-spec run codegen` and grep the generated
`api.ts` to confirm `.nullish()` before wiring routes.
