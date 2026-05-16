import type { Request } from "express";

/**
 * Generic auth provider seam. The rest of the app talks to this interface,
 * never to Clerk directly. To swap providers, write a new adapter and change
 * the singleton in `./auth.ts`.
 */
export interface ExternalIdentity {
  /** Stable provider name, e.g. "clerk". Stored on the user row. */
  provider: string;
  /** Provider-side user id (e.g. Clerk user id). Stored on the user row. */
  subject: string;
  /** Optional email from the provider, surfaced in the account UI. */
  email?: string | null;
  /** Optional default screen name (e.g. first name) for new accounts. */
  defaultScreenName?: string | null;
}

export interface AuthProvider {
  /**
   * Inspect the request and return the authenticated identity, or null if
   * the caller is anonymous.
   */
  getIdentity(req: Request): Promise<ExternalIdentity | null> | ExternalIdentity | null;
}
