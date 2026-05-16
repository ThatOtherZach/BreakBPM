import type { Request } from "express";

/**
 * Generic auth provider seam. Routes never import a backend SDK directly —
 * they go through the singleton in `./auth.ts` (which composes these calls).
 *
 * Two-step contract on purpose:
 *
 *   verifyToken(req)        — cheap, sync-friendly, request-scoped credential
 *                             check. Returns just the stable subject id.
 *   getUserInfo(subject)    — async lookup against the provider's user
 *                             directory; returns email + default name.
 *
 * Splitting the two lets routes that only need to know "is this a real
 * signed-in user?" skip the directory hit, and keeps the contract thin
 * enough that swapping providers (Auth0, Cognito, Replit Auth, etc.) is a
 * one-file change.
 */
export interface VerifiedToken {
  /** Stable provider name, e.g. "clerk". Persisted on the user row. */
  provider: string;
  /** Provider-side user id (e.g. Clerk user id). Persisted on the user row. */
  subject: string;
}

export interface UserInfo {
  email?: string | null;
  defaultScreenName?: string | null;
}

export interface ExternalIdentity extends VerifiedToken, UserInfo {}

export interface AuthProvider {
  /**
   * Cheap credential check — return the verified subject for a request, or
   * null if the caller is anonymous. Must NOT call out to the provider's
   * user-directory API.
   */
  verifyToken(req: Request): Promise<VerifiedToken | null> | VerifiedToken | null;

  /**
   * Look up extended user info (email, name) for a verified subject. May
   * call out to the provider; tolerated to fail (returns nulls).
   */
  getUserInfo(subject: string): Promise<UserInfo>;
}
