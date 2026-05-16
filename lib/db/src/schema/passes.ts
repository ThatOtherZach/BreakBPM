import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Passes are stored as start-datetime + duration. A user is "active" if any
 * pass satisfies `startedAt <= now < startedAt + durationSeconds`. Lifetime
 * passes are encoded as a 999-year duration. Multiple passes can stack —
 * we never modify or extend an existing row; we only insert new ones.
 */
export const passKindEnum = ["day", "year", "lifetime"] as const;
export type PassKind = (typeof passKindEnum)[number];

const SECONDS_DAY = 24 * 60 * 60;
const SECONDS_YEAR = 365 * SECONDS_DAY;

export const PASS_DURATIONS_SECONDS: Record<PassKind, number> = {
  day: SECONDS_DAY,
  year: SECONDS_YEAR,
  lifetime: 999 * SECONDS_YEAR,
};

export const passesTable = pgTable(
  "passes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // "day" | "year" | "lifetime"
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    source: text("source").notNull(), // "purchase" | "discount_code" | "grant"
    sourceRef: text("source_ref"),    // discount code id, payment intent id, etc.
    priceCents: integer("price_cents"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("passes_user_idx").on(t.userId)],
);

export const insertPassSchema = createInsertSchema(passesTable).omit({ createdAt: true });
export type InsertPass = z.infer<typeof insertPassSchema>;
export type Pass = typeof passesTable.$inferSelect;
