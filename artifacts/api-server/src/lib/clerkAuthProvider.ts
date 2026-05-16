/**
 * Clerk adapter for the AuthProvider interface. ALL `@clerk/express` imports
 * are quarantined to this file — swap in a different adapter to change auth
 * backends without touching routes.
 */
import { getAuth, clerkClient } from "@clerk/express";
import type { Request } from "express";
import type { AuthProvider, ExternalIdentity } from "./authProvider";

export class ClerkAuthProvider implements AuthProvider {
  async getIdentity(req: Request): Promise<ExternalIdentity | null> {
    const auth = getAuth(req);
    const subject = auth?.userId;
    if (!subject) return null;

    let email: string | null = null;
    let defaultScreenName: string | null = null;
    try {
      const user = await clerkClient.users.getUser(subject);
      email =
        user.primaryEmailAddress?.emailAddress ??
        user.emailAddresses?.[0]?.emailAddress ??
        null;
      defaultScreenName =
        user.firstName ??
        user.username ??
        (email ? email.split("@")[0] : null);
    } catch {
      // Tolerate Clerk lookup failures — just provision with a generic name.
    }

    return {
      provider: "clerk",
      subject,
      email,
      defaultScreenName,
    };
  }
}
