import { useCallback } from "react";
import { useLocation } from "wouter";

// Tracks how deep the current entry is within THIS app session so a "Back"
// button can use the real browser history (returning to the exact page you
// came from) instead of a hardcoded destination, while still having a safe
// fallback when the page was deep-linked (opened directly, with no in-app
// history behind it).
//
// We stamp every history entry with a monotonically increasing `__idx` by
// wrapping `history.pushState` / `replaceState` once. Wouter navigates through
// those same APIs, so every in-app navigation gets stamped automatically. An
// entry with `__idx > 0` has at least one earlier in-app entry behind it, so
// `history.back()` is guaranteed to land on another page of this app; `__idx
// === 0` is the session's first entry (a deep link / fresh load), where back
// would leave the site — so we route to the provided fallback instead.

let patched = false;
let counter = 0;

function initNavHistory(): void {
  if (patched || typeof window === "undefined") return;
  patched = true;

  const h = window.history;
  const existing = (h.state && typeof h.state.__idx === "number") ? h.state.__idx : null;
  counter = existing ?? 0;
  if (existing === null) {
    h.replaceState({ ...(h.state ?? {}), __idx: counter }, "");
  }

  const origPush = h.pushState.bind(h);
  h.pushState = function (state, unused, url) {
    counter += 1;
    return origPush({ ...(state ?? {}), __idx: counter }, unused, url);
  };

  const origReplace = h.replaceState.bind(h);
  h.replaceState = function (state, unused, url) {
    const idx = (h.state && typeof h.state.__idx === "number") ? h.state.__idx : counter;
    return origReplace({ ...(state ?? {}), __idx: idx }, unused, url);
  };
}

initNavHistory();

function canGoBack(): boolean {
  if (typeof window === "undefined") return false;
  const idx = window.history.state?.__idx;
  return typeof idx === "number" && idx > 0;
}

// Guards against a rapid double-tap on Back firing two `history.back()` calls
// before `popstate` lands (both would read the same pre-pop `__idx` and could
// over-pop past the session's first entry, off-site). Cleared on the next
// `popstate` (the back actually happened) or after a short timeout.
let navigatingBack = false;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    navigatingBack = false;
  });
}

/**
 * Returns a `goBack(fallback)` function: it pops the browser history when there
 * is an in-app page to return to, otherwise navigates to `fallback`.
 */
export function useGoBack(): (fallback: string) => void {
  const [, setLocation] = useLocation();
  return useCallback(
    (fallback: string) => {
      if (navigatingBack) return;
      if (canGoBack()) {
        navigatingBack = true;
        window.setTimeout(() => {
          navigatingBack = false;
        }, 600);
        window.history.back();
      } else {
        setLocation(fallback);
      }
    },
    [setLocation],
  );
}
