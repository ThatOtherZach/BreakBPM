import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Users — internal identity. The `id` is a random hex string (not a Clerk
 * subject). Auth provider is generic: `authProvider` + `authSubject` is a
 * unique pair, allowing the auth backend to be swapped without DB churn.
 */
export const usersTable = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    authProvider: text("auth_provider").notNull(),
    authSubject: text("auth_subject").notNull(),
    screenName: text("screen_name").notNull(),
    email: text("email"),
    /**
     * Watch-profile background theme preference. NULL = "auto" (derive the
     * splash artwork deterministically from the user's pass, matching their
     * redeem card). "none" = plain default background. Otherwise a specific
     * variant id ("shark" | "pool-player" | "hustler"). Only ever set by
     * Lifetime holders / admins; ignored for unpaid players.
     */
    profileTheme: text("profile_theme"),
    /**
     * Stable personal invite code, used to build the user's shareable invite
     * link (`/invite/{code}`). Generated lazily on first request (see
     * `getOrCreateInviteCode`), so it is NULL for users who have never opened
     * the invite affordance. Unique across all users.
     */
    inviteCode: text("invite_code"),
    /** Null until the user confirms their screen name in onboarding. */
    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("users_auth_unique").on(t.authProvider, t.authSubject),
    // Screen names double as the public /watch/{name} handle, so they must be
    // unique case-insensitively (and the lookup is case-insensitive too).
    uniqueIndex("users_screen_name_lower_unique").on(sql`lower(${t.screenName})`),
    // Invite codes resolve a link back to the inviter, so they must be unique.
    uniqueIndex("users_invite_code_unique").on(t.inviteCode),
  ],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
