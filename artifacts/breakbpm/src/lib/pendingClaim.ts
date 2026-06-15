/**
 * Persistence for a "claim my free pass" intent that was started while the
 * visitor wasn't signed in (e.g. from the `/pool-stats-app` landing page). The
 * intent is stashed here so it survives the sign-up / sign-in redirect, then
 * picked up once the user is authenticated and the claim is auto-run.
 *
 * Unlike `pendingRedeem` there is no code to carry — the reward is drawn
 * server-side — so this only records a boolean intent + timestamp. The entry
 * expires after TTL_MS so an abandoned sign-up can't silently claim days later.
 * Kept tiny and dependency-free so both the claim screen and the top-level
 * resumer can share it without a circular import.
 */
const KEY = "breakbpm:pendingClaim";
// Long enough to cover email-verification during sign-up, short enough that an
// abandoned attempt doesn't linger across sessions.
const TTL_MS = 30 * 60 * 1000;

export function savePendingClaim(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ts: Date.now() }));
  } catch {
    /* storage unavailable (private mode / quota) — degrade gracefully */
  }
}

export function readPendingClaim(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { ts?: unknown };
    const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
    if (!ts || Date.now() - ts > TTL_MS) {
      clearPendingClaim();
      return false;
    }
    return true;
  } catch {
    // Malformed entry — discard so it can't wedge the resumer.
    clearPendingClaim();
    return false;
  }
}

export function clearPendingClaim(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
