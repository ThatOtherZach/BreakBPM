import type { Request } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";
import { ClerkAuthProvider } from "./clerkAuthProvider";
import type { AuthProvider, ExternalIdentity, VerifiedToken } from "./authProvider";
import { newId } from "./ids";
import { generateUniqueScreenName } from "./screenNameGenerator";

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
    const patch: Partial<typeof usersTable.$inferInsert> = {};
    if (identity.email && identity.email !== existing.email) {
      patch.email = identity.email;
    }
    // One-time backfill for legacy users still on a `Player_xxxxx` placeholder.
    // Also stamp onboardingCompletedAt so the (now-deprecated) gate logic
    // never trips for them again.
    if (/^Player_/.test(existing.screenName)) {
      patch.screenName = await generateUniqueScreenName();
      patch.onboardingCompletedAt = new Date();
    } else if (existing.onboardingCompletedAt == null) {
      // Returning user with a chosen name but no completion stamp (old
      // onboarding flow). Just close the gate; don't touch their name.
      patch.onboardingCompletedAt = new Date();
    }
    if (Object.keys(patch).length > 0) {
      const [updated] = await db
        .update(usersTable)
        .set(patch)
        .where(eq(usersTable.id, existing.id))
        .returning();
      return updated;
    }
    return existing;
  }

  const generatedName = await generateUniqueScreenName();

  const [created] = await db
    .insert(usersTable)
    .values({
      id: newId(),
      authProvider: identity.provider,
      authSubject: identity.subject,
      screenName: generatedName,
      email: identity.email ?? null,
      // Auto-assigned at signup — no onboarding gate.
      onboardingCompletedAt: new Date(),
    })
    .returning();
  return created;
}

/**
 * Always false now that screen names are auto-assigned at signup. Kept for
 * API backwards-compat (the `needsOnboarding` field still ships on /auth/me).
 */
export function needsOnboarding(_user: User): boolean {
  return false;
}
