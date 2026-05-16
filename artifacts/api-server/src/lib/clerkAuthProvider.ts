/**
 * Clerk adapter for the AuthProvider interface. ALL `@clerk/express` imports
 * are quarantined to this file — swap in a different adapter to change auth
 * backends without touching routes.
 */
import { getAuth, clerkClient } from "@clerk/express";
import type { Request } from "express";
import type { AuthProvider, UserInfo, VerifiedToken } from "./authProvider";

export class ClerkAuthProvider implements AuthProvider {
  verifyToken(req: Request): VerifiedToken | null {
    const auth = getAuth(req);
    const subject = auth?.userId;
    if (!subject) return null;
    return { provider: "clerk", subject };
  }

  async getUserInfo(subject: string): Promise<UserInfo> {
    try {
      const user = await clerkClient.users.getUser(subject);
      const email =
        user.primaryEmailAddress?.emailAddress ??
        user.emailAddresses?.[0]?.emailAddress ??
        null;
      const defaultScreenName =
        user.firstName ??
        user.username ??
        (email ? email.split("@")[0] : null);
      return { email, defaultScreenName };
    } catch {
      // Tolerate Clerk lookup failures — caller will use placeholders.
      return { email: null, defaultScreenName: null };
    }
  }
}
