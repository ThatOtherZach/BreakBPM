import { pgTable, text, timestamp, integer, jsonb, boolean, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Persisted games. Created at /games/start with `endedAt = null` (in-progress)
 * and finalized at /games/save (or by the server-side inactivity sweep,
 * which marks them as forfeits).
 *
 * `userId` is the *host* (the device that created the game and is the
 * canonical scorekeeper). Joiners are tracked in `game_participants`.
 *
 * `lastActivityAt` is bumped on every logged action by any participant.
 */
export const gamesTable = pgTable(
  "games",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    gameType: text("game_type").notNull(), // "8ball" | "9ball" | "practice"
    /** Max human player slots (1 for solo modes, 2 or 4 for versus). */
    maxPlayers: integer("max_players").notNull().default(1),
    shareCode: text("share_code").notNull(),
    winner: text("winner"),
    bpm: integer("bpm_x10"), // BPM * 10 (so 8.7 BPM → 87) to keep integer
    accuracy: integer("accuracy"), // whole-number percentage (0–100), null if no qualifying shots
    durationMs: integer("duration_ms").notNull().default(0),
    sunkBallsCount: integer("sunk_balls_count").notNull().default(0),
    outcome: text("outcome"), // null while in-progress; set at finalization
    gameState: jsonb("game_state").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** Bumped by /games/activity. Used by the inactivity sweep. */
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Null while the game is in-progress. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("games_user_ended_idx").on(t.userId, t.endedAt),
    index("games_active_idx").on(t.userId, t.lastActivityAt),
    // Code lookup for join (collision check + resolve). Not unique because
    // codes are only reserved for the cooldown window — we re-check at
    // generation time against active + recently-ended rows.
    index("games_share_code_idx").on(t.shareCode),
  ],
);

export const insertGameSchema = createInsertSchema(gamesTable);
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof gamesTable.$inferSelect;

/**
 * Player slots per game. Host gets slotIndex=0 with isHost=true at
 * /games/start; joiners are atomically allocated to the next open slot
 * at /games/join. `statsStartAt` is when this participant joined — used
 * to filter the per-participant BPM window so mid-game joiners only
 * accrue stats for shots taken after they joined.
 */
export const gameParticipantsTable = pgTable(
  "game_participants",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => gamesTable.id, { onDelete: "cascade" }),
    slotIndex: integer("slot_index").notNull(),
    /** Null for guest joiners (not signed-in). Guests are not history-eligible. */
    userId: text("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    isHost: boolean("is_host").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    /** Stats accrual cutoff. Equal to joinedAt for joiners; equal to game start for host. */
    statsStartAt: timestamp("stats_start_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when the participant explicitly leaves (forfeit on their behalf). */
    leftAt: timestamp("left_at", { withTimezone: true }),
    /**
     * This participant's own final shooting accuracy as a whole-number
     * percentage (0–100), snapshotted at game end. Null while in-progress
     * or when the participant took no qualifying shots. Lets a joiner see
     * their own accuracy in history rather than the host/winner's.
     */
    accuracy: integer("accuracy"),
    /**
     * Per-participant capability token. Set for guest participants (no
     * userId) so the client can authenticate `/games/leave` calls and
     * resume on the same device. Null for signed-in participants who
     * authenticate via Clerk.
     */
    guestToken: text("guest_token"),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.slotIndex] }),
    index("gp_game_idx").on(t.gameId),
    index("gp_user_idx").on(t.userId),
    // One user can hold at most one slot per game. Partial index — guests
    // (userId IS NULL) are not constrained.
    uniqueIndex("gp_game_user_uq").on(t.gameId, t.userId),
  ],
);

export type GameParticipant = typeof gameParticipantsTable.$inferSelect;
