import { pgTable, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Persisted games. Created at /games/start with `endedAt = null` (in-progress)
 * and finalized at /games/save (or by the server-side inactivity sweep,
 * which marks them as forfeits).
 *
 * `lastActivityAt` is bumped by the client's /games/heartbeat call. Any
 * in-progress row whose `lastActivityAt` is older than the inactivity
 * threshold is auto-forfeited the next time we touch the user's games.
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
    durationMs: integer("duration_ms").notNull().default(0),
    sunkBallsCount: integer("sunk_balls_count").notNull().default(0),
    outcome: text("outcome"), // null while in-progress; set at finalization
    gameState: jsonb("game_state").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** Bumped by /games/heartbeat. Used by the inactivity sweep. */
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Null while the game is in-progress. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("games_user_ended_idx").on(t.userId, t.endedAt),
    index("games_active_idx").on(t.userId, t.lastActivityAt),
  ],
);

export const insertGameSchema = createInsertSchema(gamesTable);
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof gamesTable.$inferSelect;
