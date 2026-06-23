import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * One row per new user who has redeemed an invite link for a free trial pass.
 *
 * The invite-link trial is one-sided (the inviter gets nothing) and granted at
 * most ONCE per new user, ever. `UNIQUE(invited_user_id)` is the canonical
 * race backstop: a second concurrent accept fails at insert time and rolls the
 * whole grant back, so a user can never end up with two trials.
 *
 * `inviterUserId` is recorded for attribution/auditing only — it grants no
 * reward. `passId` and `code` tie the trial pass + the inviter's code that was
 * used at redemption time.
 */
export const inviteRedemptionsTable = pgTable(
  "invite_redemptions",
  {
    id: text("id").primaryKey(),
    inviterUserId: text("inviter_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    invitedUserId: text("invited_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    passId: text("pass_id").notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invite_redemptions_invited_user_unique").on(t.invitedUserId),
    index("invite_redemptions_inviter_idx").on(t.inviterUserId),
  ],
);

export type InviteRedemption = typeof inviteRedemptionsTable.$inferSelect;
