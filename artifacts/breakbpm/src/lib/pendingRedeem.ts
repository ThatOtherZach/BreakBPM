/**
 * Persistence for a redeem code that arrived via a share link (`/redeem/:code`)
 * but couldn't be applied yet because the visitor wasn't signed in. The code is
 * stashed here so it survives the sign-up / sign-in redirect, then picked up
 * once the user is authenticated and auto-applied.
 *
 * Entries carry a timestamp and expire after TTL_MS so an abandoned sign-up
 * can't silently apply a code days later. Kept tiny and dependency-free so both
 * the redeem screen and the top-level resumer can share it without a circular
 * import.
 */
const KEY = "breakbpm:pendingRedeem";
// Long enough to cover email-verification during sign-up, short enough that an
// abandoned attempt doesn't linger across sessions.
const TTL_MS = 30 * 60 * 1000;

export function savePendingRedeem(code: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, ts: Date.now() }));
  } catch {
    /* storage unavailable (private mode / quota) — degrade gracefully */
  }
}

export function readPendingRedeem(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code?: unknown; ts?: unknown };
    const code = typeof parsed.code === "string" ? parsed.code : null;
    const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
    if (!code || Date.now() - ts > TTL_MS) {
      clearPendingRedeem();
      return null;
    }
    return code;
  } catch {
    // Malformed entry — discard so it can't wedge the resumer.
    clearPendingRedeem();
    return null;
  }
}

export function clearPendingRedeem(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
