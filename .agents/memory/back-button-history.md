---
name: Back button uses real browser history
description: How the "← Back" buttons return to the actual previous page instead of a hardcoded route
---

The app's "← Back" buttons must return to the page the user actually came from, not a fixed destination.

**Rule:** Route wrappers in `App.tsx` pass `onBack={() => goBack(fallback)}` from `useGoBack()` (`src/lib/navHistory.ts`), NOT `setLocation(fixedPath)`. The old hardcoded value becomes the `fallback`.

**How it works:** `navHistory.ts` wraps `history.pushState`/`replaceState` once (on import) to stamp every entry with a monotonic `__idx`. `goBack(fallback)` calls `window.history.back()` when `history.state.__idx > 0` (there is an earlier in-app entry), else `setLocation(fallback)` for deep-linked / fresh-load entries where back would leave the site. Wouter navigates through the same History APIs, so every in-app nav is stamped automatically.

**Why:** Each screen's onBack was hardcoded (e.g. city leaderboard → `/leaderboard`), so reaching a page from a non-default path sent Back to the wrong place. Reported as "back button doesn't go back to the page you left."

**How to apply:** Any NEW screen/route added with a Back button should use `goBack("<safe-fallback>")`, never a bare `setLocation`. Keep the fallback as the sensible home for direct visits.
