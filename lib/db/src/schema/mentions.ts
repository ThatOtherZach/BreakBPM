import {
  pgTable,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { gamesTable } from "./games";

/**
 * A game mention is a host-pushed, opt-in invite linking a registered user to
 * a finished game without a join code. It is deliberately kept SEPARATE from
 * game_participants so a pending invite never leaks into the recipient's
 * history or stats: only on Accept do we create the real participant slot.
 *
 *   - pending  → awaiting the recipient's decision (never counts).
 *   - accepted → a real participant slot now exists; the game counts.
 *   - declined → removed by the recipient (pending decline or accepted
 *                remove-me); never counts again.
 *
 * `slotIndex` / `displayName` snapshot the gameState player slot the host used
 * for this mention so Accept can recreate the exact participant attribution
 * (the shot log records `displayName` as the slot's player name).
 */
export const mentionStatusEnum = ["pending", "accepted", "declined"] as const;
export type MentionStatus = (typeof mentionStatusEnum)[number];

export const gameMentionsTable = pgTable(
  "game_mentions",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => gamesTable.id, { onDelete: "cascade" }),
    invitedUserId: text("invited_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    slotIndex: integer("slot_index").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [
    index("game_mentions_invited_idx").on(t.invitedUserId),
    index("game_mentions_game_idx").on(t.gameId),
    // A user can only ever hold one invite per game (no duplicate invites).
    uniqueIndex("game_mentions_game_user_uniq").on(t.gameId, t.invitedUserId),
  ],
);

export const insertGameMentionSchema = createInsertSchema(gameMentionsTable).omit({
  createdAt: true,
});
export type InsertGameMention = z.infer<typeof insertGameMentionSchema>;
export type GameMention = typeof gameMentionsTable.$inferSelect;
