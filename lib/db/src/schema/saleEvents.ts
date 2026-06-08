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
 * Sales ledger — ONE valued, taxed row per pass-issuance event that is a
 * recordable sale (crypto purchase, code redemption, Stripe purchase /
 * subscription renewal). This is the source of truth the admin exports for the
 * accountant.
 *
 * Why a dedicated table (and not just `passes.price_cents`): the passes table
 * only records a price on DIRECT purchases — a redeemed code issues a pass at
 * `price_cents = 0`, so a paid Lucky Break code would look worthless. This
 * ledger records the real CAD value at EVERY issuance path.
 *
 * Tax is computed + FROZEN at sale time (Canada requires the tax figure as of
 * the moment of sale), so the six tax columns are persisted and never
 * recomputed even if rates change later. Rates are flat BC-Canada: GST 5% +
 * PST 7%, treated as tax-INCLUSIVE (backed out of the gross). Comps
 * (admin/gift/seed codes) are recorded at $0 and flagged `isComp` so they
 * appear in the ledger for completeness but add nothing to revenue totals.
 */
export const saleEventTypeEnum = [
  "crypto_purchase",
  "stripe_purchase",
  "subscription_renewal",
  "code_redemption",
] as const;
export type SaleEventType = (typeof saleEventTypeEnum)[number];

export const salePaymentMethodEnum = ["crypto", "stripe", "code"] as const;
export type SalePaymentMethod = (typeof salePaymentMethodEnum)[number];

export const saleEventsTable = pgTable(
  "sale_events",
  {
    id: text("id").primaryKey(),
    // Nullable + ON DELETE SET NULL so the ledger survives a user deletion —
    // the accounting record must outlive the account.
    userId: text("user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(), // SaleEventType
    productLabel: text("product_label").notNull(), // "Day Pass", "Lucky Break", ...
    paymentMethod: text("payment_method").notNull(), // SalePaymentMethod
    isComp: boolean("is_comp").notNull().default(false),
    // All amounts in integer cents, CAD. The tax columns are computed once at
    // sale time (see tax.ts) and stored; gst + pst + net always sums to gross.
    grossCents: integer("gross_cents").notNull(),
    gstCents: integer("gst_cents").notNull(),
    pstCents: integer("pst_cents").notNull(),
    netCents: integer("net_cents").notNull(),
    gstRateBps: integer("gst_rate_bps").notNull(),
    pstRateBps: integer("pst_rate_bps").notNull(),
    // Idempotency key: crypto tx hash / Stripe payment-intent or invoice id /
    // redemption id. Unique so duplicate webhook/verify deliveries are no-ops.
    providerRef: text("provider_ref").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sale_events_provider_ref_uniq").on(t.providerRef),
    index("sale_events_occurred_at_idx").on(t.occurredAt),
  ],
);

export const insertSaleEventSchema = createInsertSchema(saleEventsTable).omit({
  createdAt: true,
});
export type InsertSaleEvent = z.infer<typeof insertSaleEventSchema>;
export type SaleEvent = typeof saleEventsTable.$inferSelect;
