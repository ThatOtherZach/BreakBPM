import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { passesTable } from "./passes";

/**
 * A crypto checkout order is a server-issued quote for ONE one-time pass paid
 * on Base L2. The flow is connect-wallet → quote (this row) → user sends an
 * on-chain payment → verify (read the tx, grant the pass).
 *
 * Amounts are stored as decimal strings of ATOMIC units (wei for ETH, 6-dec
 * base units for USDC) so the on-chain comparison is exact and never loses
 * precision to JS number/pg-integer limits.
 *
 * The order binds the expected `payerAddress` (the connected wallet) so only
 * the actual payer can claim it — this defends against someone replaying a
 * victim's public tx hash against their own order. `txHash` is unique
 * (when set) for a second layer of replay protection; the granted pass is
 * additionally deduped on passes.source_ref = txHash (source='purchase').
 */
export const cryptoAssetEnum = ["usdc", "eth"] as const;
export type CryptoAsset = (typeof cryptoAssetEnum)[number];

export const cryptoNetworkEnum = ["base", "base-sepolia"] as const;
export type CryptoNetwork = (typeof cryptoNetworkEnum)[number];

export const cryptoOrderStatusEnum = [
  "pending",
  "paid",
  "expired",
  "failed",
] as const;
export type CryptoOrderStatus = (typeof cryptoOrderStatusEnum)[number];

export const cryptoOrdersTable = pgTable(
  "crypto_orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // What this order grants on payment. Either a fixed one-time pass kind
    // ("day" | "month" | "year" | "lifetime") OR the "lucky_break" sentinel,
    // which runs the seeded Lucky Break draw on confirmation and grants the
    // won tier (Monthly floor, fixed-odds Lifetime) instead of a fixed pass.
    passKind: text("pass_kind").notNull(),
    asset: text("asset").notNull(), // "usdc" | "eth"
    network: text("network").notNull(), // "base" | "base-sepolia"
    chainId: integer("chain_id").notNull(),
    // Our receiving wallet snapshot at quote time (config can change later).
    receivingAddress: text("receiving_address").notNull(),
    // The connected wallet expected to pay (lowercased), for the optional
    // connect-wallet shortcut — verify then requires the on-chain sender to
    // match. NULL for a "manual" order (pay-to-address / QR), which is instead
    // claimed by its UNIQUE exact `expectedAmount` so any wallet can pay it.
    payerAddress: text("payer_address"),
    // ERC-20 contract for USDC payments; NULL for native ETH.
    tokenAddress: text("token_address"),
    // Atomic units as a decimal string (wei / 6-dec USDC base units).
    expectedAmount: text("expected_amount").notNull(),
    priceCents: integer("price_cents").notNull(),
    // Snapshot of the raw Chainlink ETH/USD answer used to lock the ETH quote
    // (decimal string). NULL for USDC orders.
    ethUsdRaw: text("eth_usd_raw"),
    status: text("status").notNull().default("pending"),
    // The settling transaction hash (lowercased), once verified.
    txHash: text("tx_hash"),
    // The pass row issued on a successful payment.
    passId: text("pass_id").references(() => passesTable.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("crypto_orders_user_idx").on(t.userId),
    // Replay protection: a single on-chain tx can settle only one order.
    // Partial so unpaid (NULL txHash) orders don't collide.
    uniqueIndex("crypto_orders_tx_hash_uniq")
      .on(t.txHash)
      .where(sql`${t.txHash} IS NOT NULL`),
    // Manual (payer-less) orders are claimed by their UNIQUE exact amount, so a
    // single payment maps to exactly one order. Enforce that uniqueness ATOMICALLY
    // at the DB level (the quote path inserts with ON CONFLICT + retry) — without
    // this, two concurrent quotes could pick the same amount and one payment
    // could ambiguously satisfy either order. Scoped to live (pending|paid)
    // manual orders so expired/failed amounts can be safely recycled.
    uniqueIndex("crypto_orders_manual_amount_uniq")
      .on(t.receivingAddress, t.asset, t.expectedAmount)
      .where(
        sql`${t.payerAddress} IS NULL AND ${t.status} IN ('pending', 'paid')`,
      ),
  ],
);

export const insertCryptoOrderSchema = createInsertSchema(cryptoOrdersTable).omit(
  { createdAt: true, updatedAt: true },
);
export type InsertCryptoOrder = z.infer<typeof insertCryptoOrderSchema>;
export type CryptoOrder = typeof cryptoOrdersTable.$inferSelect;
