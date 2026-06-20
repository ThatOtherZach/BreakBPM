import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Moderation status of an ad.
 *  - `approved`     — live in rotation (subject to the expiry window). House
 *    ads created by admins default here so they show immediately.
 *  - `pending_review` — a user-bought ad awaiting admin moderation. Paid for,
 *    but NOT shown until approved (which sets its start/expiry window).
 *  - `denied`       — rejected by an admin. Never shown; payment is kept.
 */
export const adStatusEnum = ["pending_review", "approved", "denied"] as const;
export type AdStatus = (typeof adStatusEnum)[number];

/**
 * Text ads shown inside the live game HUD to non-paying users (anyone whose
 * entitlement tier is not `pass`). Each ad is a plain headline + tagline — no
 * images, links, or targeting.
 *
 * Two sources:
 *  - HOUSE ads — created by admins (`ownerUserId` NULL), default `approved`,
 *    no expiry (`days`/`expiryAt` NULL → never expire). Admins add and delete.
 *  - PAID ads — bought by a signed-in user (`ownerUserId` set) for a chosen
 *    run length (`days`) via crypto checkout. They land `pending_review`; an
 *    admin approve sets `startAt = now` and `expiryAt = now + days` so the ad
 *    goes live for exactly the purchased window.
 *
 * Active (shown) = `status = 'approved'` AND (`expiryAt` IS NULL OR
 * `expiryAt` > now). Rotation order is by `createdAt` (oldest first); the HUD
 * advances a client-side localStorage pointer once per game so all ads get
 * airtime without any server-side rotation state (keeps the DB free to
 * auto-suspend).
 */
export const adsTable = pgTable(
  "ads",
  {
    id: text("id").primaryKey(),
    headline: text("headline").notNull(),
    tagline: text("tagline").notNull(),
    /** Audit: which user record created the ad row (admin for house ads, the
     * buyer for paid ads). */
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** The buyer who owns this ad (for paid ads). NULL = a house/admin ad.
     * Drives the public "Sponsored by <screen name>" credit. */
    ownerUserId: text("owner_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    /** Moderation status (see adStatusEnum). Defaults `approved` so existing +
     * admin-created house ads stay live without a backfill. */
    status: text("status").notNull().default("approved"),
    /** Purchased run length in days (paid ads only; NULL for house ads). */
    days: integer("days"),
    /** Frozen total price paid in USD cents (paid ads only; audit). */
    priceCents: integer("price_cents"),
    /** When the live window starts — set on admin approval (paid ads). NULL
     * until approved / for house ads. */
    startAt: timestamp("start_at", { withTimezone: true }),
    /** When the ad stops showing — set on approval to start + days (paid ads).
     * NULL = never expires (house ads). */
    expiryAt: timestamp("expiry_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Rotation + admin list both order by creation time.
    index("ads_created_at_idx").on(t.createdAt),
    // The public active-ads filter scans by status (+ expiry).
    index("ads_status_idx").on(t.status),
  ],
);

export const insertAdSchema = createInsertSchema(adsTable).omit({
  createdAt: true,
});
export type InsertAd = z.infer<typeof insertAdSchema>;
export type Ad = typeof adsTable.$inferSelect;
