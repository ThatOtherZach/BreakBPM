---
name: Wiring stripe-replit-sync on Replit
description: Two environment-specific gotchas when wiring the Replit Stripe connector + stripe-replit-sync into a bundled Node server.
---

# Wiring stripe-replit-sync on Replit

Two non-obvious walls hit when adding real Stripe (connector + `stripe-replit-sync`)
to a server artifact. Both cost multiple debugging cycles.

## 1. Connector credential field is `settings.secret`, NOT `settings.secret_key`

The Replit Stripe connector proxy (`/api/v2/connection?...connector_names=stripe`)
returns `items[0].settings` with keys: `account_id`, `secret`, `publishable`,
`mcp`, `claim_url`. The secret key lives in `settings.secret`.

**Why it matters:** The generic Stripe code template (and many examples) read
`settings.secret_key` and `settings.webhook_secret` — both are absent here, so the
client silently throws "missing secret key" even though Stripe is connected.

**How to apply:** Read `settings.secret` for the API key. There is NO webhook
secret in the connection — managed webhooks own their signing secret (stored in
the synced `stripe` schema by `findOrCreateManagedWebhook`). Construct
`StripeSync` with `stripeWebhookSecret: ""`; `StripeSync.processWebhook` verifies
signatures internally. For any custom event reconciliation, run `processWebhook`
first (it verifies + throws on bad sig), THEN `JSON.parse` the already-verified
raw body into a `Stripe.Event` — you cannot re-verify yourself without the secret.

## 2. `stripe-replit-sync` must be esbuild-`external`, or migrations silently no-op

`runMigrations` resolves its SQL migrations folder via `import.meta.url`
(`path.resolve(__dirname, "./migrations")`). When the server is bundled by
esbuild, that URL points at the server's own `dist/` (no migrations there), so
`runMigrations` creates the empty `stripe` schema and applies ZERO migrations
without throwing. Symptom: server logs `relation "stripe.accounts" does not exist`
from `findOrCreateManagedWebhook`, and `stripe` schema has 0 tables.

**How to apply:** Add `"stripe-replit-sync"` to the esbuild `external` array so it
resolves its own files from `node_modules` at runtime. After fixing, the empty
pre-existing `stripe` schema does not block — `runMigrations` fills it (≈29 tables).
