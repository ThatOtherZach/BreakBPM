---
name: drizzle wraps pg error codes on .cause
description: SQLSTATE (e.g. 23505) checks must look at err.cause?.code, not just err.code, when going through drizzle
---

When a query goes through drizzle-orm, the thrown error is a wrapper ("Failed
query: ...") whose `.code` is **undefined**; the real Postgres SQLSTATE
(e.g. `23505` unique violation) sits on `err.cause.code`.

**Why:** Inline guards written as `(e as { code?: string }).code === "23505"`
silently never fire through drizzle — the duplicate-key path falls through to a
generic 500 instead of the intended friendly refusal. This was the live bug in
the discount-code redeem duplicate guard: the unique (code,user_id) violation
returned a 500 instead of "You've already redeemed this code". The tx still
rolled back (no leaked pass / burned cap slot), but the UX/handling was wrong.

**How to apply:** Check both: `e.code ?? e.cause?.code`. There is already a
cause-aware helper `isUniqueViolation(err)` in
`artifacts/api-server/src/routes/findPlayers.ts` — prefer that pattern. Other
inline `.code === "23505"` sites (crypto.ts, giftCodes.ts PK-collision retry)
have the same latent flaw if they ever run through a drizzle wrapper.
