/**
 * Persistence for an invite code that arrived via an invite link
 * (`/invite/:code`) but couldn't be applied yet because the visitor wasn't
 * signed in. The code is stashed here so it survives the sign-up / sign-in
 * redirect, then picked up once authenticated and auto-applied.
 *
 * Mirrors pendingRedeem.ts: entries carry a timestamp and expire after TTL_MS
 * so an abandoned sign-up can't silently apply an invite days later. Kept tiny
 * and dependency-free so both the invite screen and the top-level resumer can
 * share it without a circular import.
 */
const KEY = "breakbpm:pendingInvite";
// Long enough to cover email-verification during sign-up, short enough that an
// abandoned attempt doesn't linger across sessions. Kept in lockstep with the
// server's INVITE_SIGNUP_WINDOW_MS (both 30 min) so a stashed invite never
// outlives the server's new-user window.
const TTL_MS = 30 * 60 * 1000;

export function savePendingInvite(code: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, ts: Date.now() }));
  } catch {
    /* storage unavailable (private mode / quota) — degrade gracefully */
  }
}

export function readPendingInvite(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code?: unknown; ts?: unknown };
    const code = typeof parsed.code === "string" ? parsed.code : null;
    const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
    if (!code || Date.now() - ts > TTL_MS) {
      clearPendingInvite();
      return null;
    }
    return code;
  } catch {
    // Malformed entry — discard so it can't wedge the resumer.
    clearPendingInvite();
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
