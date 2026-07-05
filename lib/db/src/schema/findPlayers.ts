import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { venuesTable } from "./venues";

/**
 * "Find Players" meetup board posts. Each row is a paid user's invitation to
 * play at a real-world location + time. Times are stored in UTC and never
 * surfaced as UTC to users (the client treats the wall-clock value verbatim).
 *
 * Lifecycle:
 *  - Created by a paid (tier === 'pass') user at /find-players/posts.
 *  - Visible until `scheduledAt` passes, then filtered out at read time and
 *    purged by a sweep-on-write/read (NOT an in-process timer, which would
 *    not survive a restart).
 *  - The creator may cancel: `cancelledAt` is set, the place/time are no
 *    longer exposed, and the card shows a "Cancelled" badge until the
 *    original `scheduledAt` passes (when it is purged like any other post).
 *
 * `scheduledDateUtc` is the "YYYY-MM-DD" UTC calendar date of `scheduledAt`,
 * denormalized so a partial unique index can enforce the "one active post per
 * UTC date per user" rule durably (active = not cancelled).
 */
export const findPlayerPostsTable = pgTable(
  "find_player_posts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    tableNumber: integer("table_number").notNull(),
    /** Scheduled meetup time, stored in UTC. */
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    /** "YYYY-MM-DD" UTC calendar date of scheduledAt — backs the per-date index. */
    scheduledDateUtc: text("scheduled_date_utc").notNull(),
    /** Human-readable reverse-geocoded label e.g. "Los Angeles, United States". */
    locationLabel: text("location_label"),
    /**
     * Auto-linked Verified Hall: set at creation when the pin falls within the
     * hall-tag radius (300 m) of an active verified venue, resolved lazily on
     * the read path for rows created before the feature existed (see
     * `hallLinkResolvedAt`). The 📍 label then links to that hall's
     * leaderboard. Null = no hall that close (the card falls back to a city
     * leaderboard link, computed at read time from the nearest hall's city).
     */
    venueId: text("venue_id").references(() => venuesTable.id, {
      onDelete: "set null",
    }),
    /**
     * When the hall auto-link was last resolved. Null on legacy rows created
     * before auto-linking existed — the list read path self-heals those by
     * computing + persisting the match on first sight (one-time backfills
     * don't reach production automatically).
     */
    hallLinkResolvedAt: timestamp("hall_link_resolved_at", { withTimezone: true }),
    /** Null while active. Set when the creator cancels. */
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Sorting (soonest-first) + the expiry purge sweep both scan by time.
    index("fpp_scheduled_idx").on(t.scheduledAt),
    index("fpp_user_idx").on(t.userId),
    // Durable "one ACTIVE post per UTC date per user" guarantee. Cancelled
    // rows (cancelled_at IS NOT NULL) are excluded so a user can re-post for
    // a date they previously cancelled.
    uniqueIndex("fpp_user_date_active_uq")
      .on(t.userId, t.scheduledDateUtc)
      .where(sql`${t.cancelledAt} IS NULL`),
  ],
);

export const insertFindPlayerPostSchema = createInsertSchema(findPlayerPostsTable).omit({
  createdAt: true,
});
export type InsertFindPlayerPost = z.infer<typeof insertFindPlayerPostSchema>;
export type FindPlayerPost = typeof findPlayerPostsTable.$inferSelect;
