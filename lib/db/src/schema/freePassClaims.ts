import {
  pgTable,
  text,
  integer,
  timestamp,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Free-pass claims — the landing-page giveaway ("reveal my free pass").
 *
 * Each account may claim ONCE EVER: the `free_pass_claims_user_unique` index on
 * `userId` is the canonical one-per-account guard. Concurrent claims race past
 * any pre-check and fail at INSERT time with a duplicate-key error, rolling the
 * whole transaction back (including the pool increment) rather than minting two
 * passes.
 *
 * A claim mints a single-use discount code (`issuerKind = 'claim'`) that grants
 * either a Lucky Break roll (`rewardKind = 'lucky_break'`) or a Day pass
 * (`rewardKind = 'day'`), then redeems it in the same transaction. The minted
 * code is recorded here so the claim row is self-describing for support/debug.
 *
 * Monthly stock is governed by `free_pass_claim_pools` (an atomic counter), NOT
 * by COUNT()ing these rows — counting under normal isolation would oversell.
 */
export const freePassClaimsTable = pgTable(
  "free_pass_claims",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** "lucky_break" | "day" — which reward this claim drew. */
    rewardKind: text("reward_kind").notNull(),
    /** The minted single-use discount code, e.g. "LB-JUN26-001". */
    code: text("code").notNull(),
    /** Calendar period this claim counted against, e.g. "2026-06". */
    periodKey: text("period_key").notNull(),
    /** 1-based sequence within the (periodKey, rewardKind) pool — the label seq. */
    sequence: integer("sequence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("free_pass_claims_user_unique").on(t.userId)],
);

/**
 * Per-period reward inventory. One row per (periodKey, rewardKind). The monthly
 * cap is enforced atomically with
 *
 *   UPDATE ... SET claimed_count = claimed_count + 1
 *   WHERE claimed_count < <cap> RETURNING claimed_count
 *
 * so concurrent claims can never oversell — there is no COUNT()-based race. The
 * returned `claimedCount` doubles as the 1-based sequence label for the minted
 * code. Rows are created lazily (ON CONFLICT DO NOTHING) on first claim of a
 * period; a new calendar month is simply a new `periodKey`, so stock "resets"
 * on the 1st without any scheduled job.
 */
export const freePassClaimPoolsTable = pgTable(
  "free_pass_claim_pools",
  {
    periodKey: text("period_key").notNull(),
    rewardKind: text("reward_kind").notNull(),
    claimedCount: integer("claimed_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.periodKey, t.rewardKind] })],
);

export const insertFreePassClaimSchema = createInsertSchema(freePassClaimsTable).omit({
  createdAt: true,
});
export type InsertFreePassClaim = z.infer<typeof insertFreePassClaimSchema>;
export type FreePassClaim = typeof freePassClaimsTable.$inferSelect;
export type FreePassClaimPool = typeof freePassClaimPoolsTable.$inferSelect;
