import { pgTable, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Persisted completed games. Only saved for signed-in users. All historical
 * rows are retained; the free-account history view only displays the 3 most
 * recent (gating happens in the route, not at the DB level).
 *
 * `gameState` is the full GameState JSON snapshot at completion — keeps the
 * schema flexible as game logic evolves.
 */
export const gamesTable = pgTable(
  "games",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    gameType: text("game_type").notNull(), // "8ball" | "9ball" | "practice"
    shareCode: text("share_code").notNull(),
    winner: text("winner"),
    bpm: integer("bpm_x10"), // BPM * 10 (so 8.7 BPM → 87) to keep integer
    durationMs: integer("duration_ms").notNull(),
    sunkBallsCount: integer("sunk_balls_count").notNull(),
    outcome: text("outcome").notNull(), // "won" | "lost" | "forfeit" | "completed"
    gameState: jsonb("game_state").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("games_user_ended_idx").on(t.userId, t.endedAt)],
);

export const insertGameSchema = createInsertSchema(gamesTable);
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof gamesTable.$inferSelect;
