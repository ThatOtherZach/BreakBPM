import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Recurring subscriptions are a SEPARATE entitlement source from one-time
 * passes (see passes.ts). Day and Lifetime remain passes; Monthly and Yearly
 * are subscriptions. A subscription auto-renews until cancelled.
 *
 * A subscription grants access while `status = 'active'` AND
 * `current_period_end > now`. `cancel_at_period_end` lets a user stop a
 * renewal without losing access until the paid-through date — the row stays
 * `active` until `current_period_end` passes.
 *
 * The provider* columns hold opaque references (e.g. Stripe customer /
 * subscription ids) so a real billing provider can reconcile against this
 * table later. They are NULL until a provider is wired up.
 */
export const subscriptionIntervalEnum = ["month", "year"] as const;
export type SubscriptionInterval = (typeof subscriptionIntervalEnum)[number];

export const subscriptionStatusEnum = ["active", "past_due", "canceled"] as const;
export type SubscriptionStatus = (typeof subscriptionStatusEnum)[number];

export const subscriptionsTable = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    status: text("status").notNull(), // "active" | "past_due" | "canceled"
    interval: text("interval").notNull(), // "month" | "year"
    priceCents: integer("price_cents").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    // Paid-through date. Access is granted while this is in the future and the
    // row is active. A real provider advances this on each successful renewal.
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    // When true, the subscription will not renew past current_period_end.
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    source: text("source").notNull(), // "purchase" | "grant"
    provider: text("provider"), // "stripe" | etc — NULL until wired
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subscriptions_user_idx").on(t.userId),
    // Idempotency guard: one Stripe subscription id maps to exactly one row,
    // so the verify endpoint and the customer.subscription.* webhook can't
    // race into two rows for the same subscription. NULLs (legacy/granted
    // subs with no provider id) are treated as distinct by Postgres.
    uniqueIndex("subscriptions_provider_sub_uniq").on(t.providerSubscriptionId),
  ],
);

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
