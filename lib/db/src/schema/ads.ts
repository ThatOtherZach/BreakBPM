import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Admin-managed "text ads" shown inside the live game HUD to non-paying users
 * (anyone whose entitlement tier is not `pass`). Each ad is a plain headline +
 * tagline — no images, links, targeting, or scheduling. Admins add and delete
 * ads; every saved ad is in rotation (deletion is the only way to remove one).
 *
 * Rotation order is by `createdAt` (oldest first); the HUD advances a
 * client-side localStorage pointer once per game so all ads get airtime without
 * any server-side rotation state (keeps the DB free to auto-suspend).
 */
export const adsTable = pgTable(
  "ads",
  {
    id: text("id").primaryKey(),
    headline: text("headline").notNull(),
    tagline: text("tagline").notNull(),
    /** Audit: which admin created the ad. */
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Rotation + admin list both order by creation time.
    index("ads_created_at_idx").on(t.createdAt),
  ],
);

export const insertAdSchema = createInsertSchema(adsTable).omit({
  createdAt: true,
});
export type InsertAd = z.infer<typeof insertAdSchema>;
export type Ad = typeof adsTable.$inferSelect;
