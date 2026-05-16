import type { Request } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";
import { ClerkAuthProvider } from "./clerkAuthProvider";
import type { AuthProvider, ExternalIdentity, VerifiedToken } from "./authProvider";
import { newId } from "./ids";

/** Single point at which we choose the auth backend. */
export const authProvider: AuthProvider = new ClerkAuthProvider();

/**
 * Cheap path: just the verified subject + provider, no directory hit.
 * Use this when the route only needs "are they signed in?".
 */
export async function getVerifiedSubject(req: Request): Promise<VerifiedToken | null> {
  return authProvider.verifyToken(req);
}

/**
 * Full identity (subject + email + default name) — composes the cheap
 * verifyToken path with the slower getUserInfo lookup. Routes that need to
 * provision/update the local user row use this.
 */
export async function getIdentity(req: Request): Promise<ExternalIdentity | null> {
  const verified = await authProvider.verifyToken(req);
  if (!verified) return null;
  const info = await authProvider.getUserInfo(verified.subject);
  return { ...verified, ...info };
}

/**
 * Resolve the local user row for the request, creating it on first sight.
 * Returns null for anonymous callers. New users get a placeholder screen
 * name + onboardingCompletedAt = null until they confirm via /auth/screen-name.
 */
export async function getOrCreateUser(req: Request): Promise<User | null> {
  const identity = await getIdentity(req);
  if (!identity) return null;
  return upsertUserFromIdentity(identity);
}

export async function upsertUserFromIdentity(identity: ExternalIdentity): Promise<User> {
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.authProvider, identity.provider),
        eq(usersTable.authSubject, identity.subject),
      ),
    )
    .limit(1);

  if (existing) {
    if (identity.email && identity.email !== existing.email) {
      await db
        .update(usersTable)
        .set({ email: identity.email })
        .where(eq(usersTable.id, existing.id));
      existing.email = identity.email;
    }
    return existing;
  }

  const placeholderName = `Player_${Math.random().toString(36).slice(2, 7)}`;

  const [created] = await db
    .insert(usersTable)
    .values({
      id: newId(),
      authProvider: identity.provider,
      authSubject: identity.subject,
      screenName: placeholderName,
      email: identity.email ?? null,
      onboardingCompletedAt: null,
    })
    .returning();
  return created;
}

export function needsOnboarding(user: User): boolean {
  return user.onboardingCompletedAt == null;
}
