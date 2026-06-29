import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, integer, jsonb, boolean, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { venuesTable } from "./venues";

/**
 * Bump when the stored summary shape changes incompatibly. Parsers treat a
 * blob without a matching `v` as "no summary" and fall back / skip, so old
 * rows are never mis-read after a shape change (re-run the backfill to lift
 * them to the new version).
 */
export const GAME_SUMMARY_VERSION = 1;

/**
 * Game-level distilled summary, stored on `games.summary` and computed once at
 * finalize (see `gameSummary.ts`). Carries every game-wide number the read
 * paths need so stats/leaderboard/history stop parsing the heavy
 * `gameState.shotLog` JSONB: ALL-players totals (so global stats can sum across
 * every shooter, including the invisible Shark), the slot-ordered player
 * snapshot (names + teams — for the viewer-relative outcome), and a compact
 * pocket sequence for the history mini-log. Empty `{}` until finalize.
 */
export interface GameSummary {
  /** Summary schema version (see GAME_SUMMARY_VERSION). */
  v: number;
  /** ALL-players "shot" count (pocket / miss / foul / safety). */
  totalShots: number;
  totalMisses: number;
  totalFouls: number;
  totalSafeties: number;
  /** Undo count carried from gameState (drives the global undos stat). */
  undoCount: number;
  /** True when an 8-ball game was decided on the 8 by any player. */
  eightDecided: boolean;
  /** True when that deciding 8-ball was a clean win (not a scratch/lose). */
  eightClean: boolean;
  /** Slot-ordered player snapshot for viewer-relative outcome resolution. */
  players: Array<{ name: string; team: string | null }>;
  /**
   * Balls in pocket order (any entry that sank a ball — sinks plus a terminal
   * win/lose that pocketed; INCLUDES the terminal lose, matching the legacy
   * history mini-log). `player` is who sank it.
   */
  pocketSequence: Array<{ ball: number; player: string }>;
}

/**
 * Per-participant distilled summary, stored on `game_participants.summary` and
 * computed once at finalize. Two windows are stored because the read paths use
 * different ones and collapsing them would regress a participant who left
 * mid-game:
 *  - STATS window `[statsStartAt, leftAt]`, attributed by `displayName` — the
 *    window personal stats AND the leaderboard use.
 *  - HISTORY window `[statsStartAt, +inf)`, attributed by the slot's player
 *    name — the window the per-game history pace uses.
 * Empty `{}` until finalize.
 */
export interface ParticipantSummary {
  /** Summary schema version (see GAME_SUMMARY_VERSION). */
  v: number;
  // ── stats window [statsStartAt, leftAt], by displayName ──
  /** Per-game BPM × 10 (null = no pockets, 0 = sub-ms). MEAN-aggregated. */
  statsBpmX10: number | null;
  /** Pocketed balls (accuracy numerator). */
  made: number;
  /** Qualifying attempts (pocket + miss + foul). Pooled for the accuracy %. */
  attempts: number;
  /** "Shot" count (pocket / miss / foul / safety). */
  shotCount: number;
  missCount: number;
  foulCount: number;
  safetyCount: number;
  /** This player's locked-in 8-ball group ("solids" | "stripes" | null). */
  team: string | null;
  /** Sink/win pocket histogram by ball (EXCLUDES terminal lose) for top-balls. */
  ballCounts: Record<string, number>;
  /** This participant decided an 8-ball game on the 8 (own terminal attempt). */
  eightDecided: boolean;
  eightClean: boolean;
  // ── history window [statsStartAt, +inf), by slot player name ──
  /** History-card BPM × 10 (null = no pockets, 0 = sub-ms). */
  historyBpmX10: number | null;
  /** History-card sunk-ball count (any entry that pocketed). */
  historySunk: number;
  /**
   * Count of this slot's attributable entries in the history window. Lets the
   * read path distinguish "no attributable shots" (→ host falls back to the
   * row-level bpm/sunk) from "shot but sank nothing" (→ genuine null/0), exactly
   * as the legacy `resolveParticipantPace` did.
   */
  historyShots: number;
}

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
    // ── Finalize-time denormalized discriminators (promoted out of gameState
    // so stats/leaderboard SQL filters never parse the JSONB). Null on
    // in-progress rows; populated at every finalize path + the backfill. ──
    /** gameState.sharkAggression ("normal"|"hard"); NULL = not a Shark game. */
    sharkAggression: text("shark_aggression"),
    /**
     * gameState.chaosMode ("eight-last"|"anything-goes"|"none"); NULL =
     * team/normal. MUST stay nullable — the leaderboard grandfathers pre-cutoff
     * games on a genuine NULL.
     */
    chaosMode: text("chaos_mode"),
    /** gameState.ruleSet (e.g. "open-through-break"); NULL = legacy. MUST stay nullable. */
    ruleSet: text("rule_set"),
    /** Host's frozen felt theme (gameState.hostTheme). NULL = default green. */
    hostTheme: text("host_theme"),
    /**
     * Why a row was force-closed (gameState.forfeitReason):
     * "max_duration_60min" | "inactivity_60min" | "all_left". NULL = natural finish.
     */
    endReason: text("end_reason"),
    /** Game-level distilled summary (see GameSummary). Empty `{}` until finalize. */
    summary: jsonb("summary").$type<GameSummary>().notNull().default(sql`'{}'::jsonb`),
    /**
     * The Verified Hall (venue) this finalized game was tagged to via the
     * host-only "Add to Hall" flow, scoping it onto that hall's House
     * Leaderboard. NULL = untagged (the default; no backfill needed). ON DELETE
     * SET NULL so deleting/retiring a hall drops the tag rather than the game.
     */
    venueId: text("venue_id").references(() => venuesTable.id, { onDelete: "set null" }),
    /**
     * The City (locality, e.g. "Los Angeles, United States") this finalized
     * game was tagged to via the host-only "Tag City" FALLBACK — used only when
     * no Verified Hall was within range, so the game still lands on a City
     * Leaderboard. Mutually exclusive with `venueId` (a game is tagged to a hall
     * XOR a city). The locality string is copied from an existing verified
     * hall's `locality`, so it always matches a real verified-hall city. NULL =
     * not city-tagged (the default; no backfill needed — hall-tagged games roll
     * up into their hall's city board via the venue-id set, not this column).
     */
    cityLocality: text("city_locality"),
  },
  (t) => [
    index("games_user_ended_idx").on(t.userId, t.endedAt),
    index("games_active_idx").on(t.userId, t.lastActivityAt),
    // Code lookup for join (collision check + resolve). Not unique because
    // codes are only reserved for the cooldown window — we re-check at
    // generation time against active + recently-ended rows.
    index("games_share_code_idx").on(t.shareCode),
    // Per-hall leaderboard scan: filter finalized games by the hall they were
    // tagged to. Partial-ish via the index; the leaderboard query adds it as a
    // conjunct to the existing eligibility filters.
    index("games_venue_idx").on(t.venueId),
    // Per-city leaderboard scan: filter finalized games directly tagged to a
    // city (the fallback path). Hall-tagged games in that city are picked up by
    // the venue index above, not this one.
    index("games_city_locality_idx").on(t.cityLocality),
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
    /** Per-participant distilled summary (see ParticipantSummary). Empty `{}` until finalize. */
    summary: jsonb("summary").$type<ParticipantSummary>().notNull().default(sql`'{}'::jsonb`),
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
