---
name: Clerk duplicate verification emails
description: Why duplicate 2FA/email-verification codes get sent during Clerk sign-in/up, and the routing constraint that prevents it.
---

# Duplicate Clerk verification emails from route remounts

If a user reports receiving **two** email verification / "2FA" codes per sign-in
or sign-up attempt, suspect a **remount of Clerk's prebuilt `<SignIn>`/`<SignUp>`**.
Each fresh mount re-runs the email-verification *prepare* step, sending another code.

**Rule:** wouter `<Route>` `component` props for auth routes (and ideally all routes)
must be **stable, module-scope named components** — never inline factories like
`component={() => <SignInPage .../>}`.

**Why:** an inline arrow creates a new component *type/identity* on every re-render
of the parent (`Routes`). React/wouter then unmount + remount the whole subtree,
including Clerk's `<SignIn>`. `Routes` re-renders on every location change, and Clerk
itself drives location changes mid-flow (navigating to the verification step), so the
remount lands right when the code is sent → duplicate email. Reproduces in production
(not a StrictMode dev artifact).

**How to apply:** if auth routes use inline factories, convert them to named wrappers
that call `useLocation()` internally (matching the pattern of the other route
components). Watch for the same trap if anyone adds unstable `key` props above auth
content. Also avoid passing closures that change the rendered element type per render.
