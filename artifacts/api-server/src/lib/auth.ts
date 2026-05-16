import type { Request } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";
import { ClerkAuthProvider } from "./clerkAuthProvider";
import type { AuthProvider, ExternalIdentity } from "./authProvider";
import { newId } from "./ids";

/** Single point at which we choose the auth backend. Swap to swap providers. */
export const authProvider: AuthProvider = new ClerkAuthProvider();

/**
 * Resolve the local user row for the request's identity, creating it on
 * first sight. Returns null for anonymous callers.
 *
 * Newly-provisioned users get a placeholder screen name and
 * `onboardingCompletedAt = null` — the client must walk them through the
 * screen-name picker (POST /auth/screen-name) before regular app entry.
 */
export async function getOrCreateUser(req: Request): Promise<User | null> {
  const identity = await authProvider.getIdentity(req);
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

  // First sight: provision a placeholder screen name. Onboarding stays
  // incomplete until the user PATCHes /auth/screen-name.
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
