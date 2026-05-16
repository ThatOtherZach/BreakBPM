import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Discount codes can issue a pass to a user when redeemed.
 * `grantsPassKind` says which pass tier the code grants.
 */
export const discountCodesTable = pgTable("discount_codes", {
  code: text("code").primaryKey(), // uppercase, e.g. "FREELIFETIME"
  grantsPassKind: text("grants_pass_kind").notNull(), // "day" | "year" | "lifetime"
  maxRedemptions: integer("max_redemptions"), // null = unlimited
  redemptionCount: integer("redemption_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const discountRedemptionsTable = pgTable("discount_redemptions", {
  id: text("id").primaryKey(),
  code: text("code")
    .notNull()
    .references(() => discountCodesTable.code, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  passId: text("pass_id").notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDiscountCodeSchema = createInsertSchema(discountCodesTable).omit({
  createdAt: true,
  redemptionCount: true,
});
export type InsertDiscountCode = z.infer<typeof insertDiscountCodeSchema>;
export type DiscountCode = typeof discountCodesTable.$inferSelect;
export type DiscountRedemption = typeof discountRedemptionsTable.$inferSelect;
