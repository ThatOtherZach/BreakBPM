---
name: Runtime-configurable client values (breakbpm)
description: How to make a client-visible value swappable at runtime without rebuilding the static Vite frontend.
---

# Runtime-configurable client values

To make a value the browser uses swappable **at runtime** (e.g. a promo URL an
operator flips via an env secret), do NOT use a `VITE_*` build-time env var —
those are baked into the static bundle at build and only change on a rebuild/redeploy.

**Instead serve it from the api-server**, which reads `process.env` fresh per
request, and have the frontend fetch it via the contract-first pipeline:

1. Add a public (no-auth) `GET /config` op to `lib/api-spec/openapi.yaml` returning
   a small schema (e.g. `AppConfig { qrUrl }`).
2. Add a reader in `artifacts/api-server/src/lib/config.ts` that reads the env var
   fresh each call, trims, and falls back to a documented default on unset/blank.
3. Serve it from a tiny `routes/config.ts`, registered in `routes/index.ts`.
4. `pnpm --filter @workspace/api-spec run codegen` → use the generated
   `useGet<Op>` hook on the client with a defensive `?? default` fallback.

**Why:** breakbpm's frontend is a static Vite build; a `VITE_` var cannot change
"in real time." The api-server has no hot reload, so changing the env still needs
an api-server **restart** (much cheaper than a frontend rebuild) — document that.

**How to apply:** any "let me change X without redeploying the app" request where X
is rendered client-side. Note `/config` is PUBLIC by design — never put true
secrets there.
