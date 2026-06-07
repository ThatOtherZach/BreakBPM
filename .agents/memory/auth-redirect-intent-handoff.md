---
name: Carrying an intent across the Clerk auth redirect
description: How to make a "do X after the user signs up" link work given Clerk always returns to "/"
---

Clerk's `<SignIn>`/`<SignUp>` use a static `forceRedirectUrl` (set to `/` / basePath in `authClient.tsx`), so after auth the user always lands on `/` — NOT back on the entry route they came from. You cannot carry per-link intent (e.g. a redeem code on `/redeem/:code`) just by redirecting to the auth page.

Pattern that works:
1. Stash the intent in localStorage with a timestamp/TTL before bouncing to sign-up (the entry screen does this on mount).
2. Add a top-level resumer component mounted alongside the router (not inside any route) that, once authenticated, reads the stash and navigates back to the entry route.
3. The screen at the entry route owns the actual action + clearing the stash (on both success and failure), guarded by a `useRef` so it fires once.

**Why:** a route-local effect can't run after auth because the route isn't mounted post-redirect; only a top-level component survives the bounce to `/`.

**How to apply:** Scope the resumer tightly or it hijacks other links — gate it on `location === "/"` AND no competing query params (e.g. BreakBPM's `?code=`/`?game=` join links are handled by MainApp, so the resumer must defer when those are present). Give the stash a TTL so an abandoned sign-up doesn't silently apply the intent in a later session. Server-side idempotency (e.g. unique (code,user_id)) makes multi-tab double-apply safe without a client lock.
