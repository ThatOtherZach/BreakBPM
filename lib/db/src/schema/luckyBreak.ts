import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Audit trail for Lucky Break rolls. One row per roll, written in the same
 * transaction that grants the won pass. A roll can originate from either a
 * redeemed Lucky Break discount code OR an on-chain crypto purchase, so the
 * source identifiers are mutually-exclusive nullable columns: code rolls carry
 * `code` + `redemptionId`; crypto rolls carry `cryptoOrderId`. Stores
 * everything needed to REPRODUCE and VERIFY the draw after the fact:
 *
 *   - `seedHash`      — SHA-256 hex of (canonical last-30d shot data | seed id).
 *   - `rolledValuePpm`— the [0,1) draw derived from the hash, in parts-per-million
 *                       (value * 1e6, stored as an integer so it round-trips exactly).
 *   - `lifetimeProbabilityBps` — the disclosed Lifetime odds in basis points
 *                       (2000 = 20%) at the time of the roll.
 *   - `outcome`       — "month" | "lifetime" (the guaranteed floor is Monthly).
 *   - `entropyShotCount` / `windowDays` — snapshot of the entropy source size.
 *
 * The draw is SEEDED (not odds-shifted) by shot data: the same seedHash always
 * produces the same outcome under the same odds. Folding the server-assigned
 * seed id (the redemption id for code rolls, the crypto order id for crypto
 * rolls) into the seed makes every roll unique even with identical shot data,
 * and prevents a caller from predicting their result.
 */
export const luckyBreakRollsTable = pgTable(
  "lucky_break_rolls",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** The redeemed discount code (null for crypto-purchased rolls). */
    code: text("code"),
    /** discount_redemptions.id folded into the seed (null for crypto rolls). */
    redemptionId: text("redemption_id"),
    /** crypto_orders.id folded into the seed (null for code rolls). */
    cryptoOrderId: text("crypto_order_id"),
    seedHash: text("seed_hash").notNull(),
    rolledValuePpm: integer("rolled_value_ppm").notNull(),
    lifetimeProbabilityBps: integer("lifetime_probability_bps").notNull(),
    outcome: text("outcome").notNull(), // "month" | "lifetime"
    entropyShotCount: integer("entropy_shot_count").notNull(),
    windowDays: integer("window_days").notNull(),
    /** The pass row granted as a result of this roll. */
    passId: text("pass_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lucky_break_rolls_user_idx").on(t.userId)],
);

export const insertLuckyBreakRollSchema = createInsertSchema(luckyBreakRollsTable).omit({
  createdAt: true,
});
export type InsertLuckyBreakRoll = z.infer<typeof insertLuckyBreakRollSchema>;
export type LuckyBreakRoll = typeof luckyBreakRollsTable.$inferSelect;
