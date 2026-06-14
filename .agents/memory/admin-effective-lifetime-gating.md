---
name: Admin effective-Lifetime perk gating
description: Lifetime-only perks must gate on the entitlement (which synthesizes Lifetime for admins), never on raw active passes.
---

# Admin effective-Lifetime perk gating

Admins (`BREAKBPM_ADMIN_EMAILS`) are treated as effective Lifetime holders:
`computeEntitlement` synthesizes a Lifetime `activePass` when an admin has no real
pass, and sets `entitlement.isAdmin`.

**Rule:** gate every Lifetime-only perk on the entitlement, i.e.
`entitlement.isAdmin || entitlement.activePass?.isLifetime`, NOT on raw
`getActivePasses()` / `passes.some(p => p.isLifetime)`.

**Why:** the synthetic Lifetime lives only inside `computeEntitlement`. Any perk
that re-queries real passes directly silently excludes admins, so the
"admins get all Lifetime perks" promise leaks per-feature. This was caught in
review: custom screen-name editing (server `routes/auth.ts` + client
`AccountScreen.tsx`) still checked real passes after the entitlement synthesis
landed, denying admins a perk they should have.

**How to apply:** when adding a new Lifetime-gated perk, resolve through
`computeEntitlement` on both the server gate and the client gate. Grep for
`isLifetime` and `getActivePasses` when auditing — direct pass checks are the
smell.

**Known exception (by design, today):** `hostSpectatingEnabled()` in
`routes/games.ts` checks RAW `getActivePasses()`/`getActiveSubscription()`, NOT
`computeEntitlement`. It gates the "paid host" spectator role AND backs
`pendingInviteCap()`. So an admin with NO real pass/subscription is treated as a
*free* host there: their live games aren't spectatable via the official role and
they get the free pending-invite cap (3, not 6). Real pass/sub removes it. If you
ever want admins fully covered for spectating/invite-caps, route those two
through the entitlement too.
