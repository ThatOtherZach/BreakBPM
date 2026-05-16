import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

/**
 * Public free-tier cooldown. Anonymous users get 1 game then a 5-minute
 * cooldown keyed by (ip, deviceId). DeviceId is a client-generated random
 * token stored in localStorage; ip is the request IP.
 */
export const publicFreeCooldownsTable = pgTable(
  "public_free_cooldowns",
  {
    ip: text("ip").notNull(),
    deviceId: text("device_id").notNull(),
    lastGameAt: timestamp("last_game_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.ip, t.deviceId] })],
);

export type PublicFreeCooldown = typeof publicFreeCooldownsTable.$inferSelect;
