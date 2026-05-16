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
    /** Null until the user confirms their screen name in onboarding. */
    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("users_auth_unique").on(t.authProvider, t.authSubject)],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
