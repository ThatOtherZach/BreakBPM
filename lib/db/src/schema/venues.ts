import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Admin-curated "Verified/Featured" pool-hall venues. Unlike the free live
 * OSM/Overpass layer (which is fetched client-side and never stored), these are
 * a small, hand-authorized set of real billiards venues an admin has vouched
 * for after contact + (offline) payment with the hall. They render with a
 * "Verified" treatment on the Find Players map, are preferred by the nearest-
 * hall compass on ties, and never disappear when OSM has no matching entry.
 *
 * Payment is recorded offline: `active` controls whether the listing is shown,
 * and `paidThroughAt` is an informational note of how long the hall has paid
 * for (no enforcement — an admin flips `active` when it lapses).
 */
export const venuesTable = pgTable(
  "venues",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    /** Short human label e.g. "Los Angeles, United States". */
    locality: text("locality"),
    /** Optional fuller street address. */
    address: text("address"),
    /** Optional number of tables (shown when known). */
    tableCount: integer("table_count"),
    /** Optional contact line (phone / handle / URL) shown in the popup. */
    contact: text("contact"),
    /**
     * How the hall charges players, as a stable token: "free" | "per_game" |
     * "hourly". Nullable (unknown). Replaces the old convention of baking the
     * pricing model into the venue name (e.g. "… (Hourly)"). Validated at the
     * API boundary (OpenAPI enum); stored as plain text so display labels can
     * change without a data migration.
     */
    paymentType: text("payment_type"),
    /** Whether the listing is currently shown on the public map. */
    active: boolean("active").notNull().default(true),
    /** Informational: how long the hall has paid through (no enforcement). */
    paidThroughAt: timestamp("paid_through_at", { withTimezone: true }),
    /** Audit: which admin added the listing. */
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The public map lists active venues; the admin panel lists all of them.
    index("venues_active_idx").on(t.active),
  ],
);

export const insertVenueSchema = createInsertSchema(venuesTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertVenue = z.infer<typeof insertVenueSchema>;
export type Venue = typeof venuesTable.$inferSelect;
