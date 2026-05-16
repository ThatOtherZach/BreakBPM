import { desc, eq, or } from "drizzle-orm";
import type { Request } from "express";
import { db, publicFreeCooldownsTable } from "@workspace/db";

export const PUBLIC_FREE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Resolve the client IP. Express' `req.ip` honors the `trust proxy` setting,
 * which is enabled in `app.ts` because we always sit behind the Replit
 * reverse proxy. Do NOT read `x-forwarded-for` directly — it's spoofable.
 */
export function getRequestIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export interface CooldownStatus {
  allowed: boolean;
  /** ms remaining until the next free game can be started. 0 if allowed. */
  remainingMs: number;
}

/**
 * The cooldown blocks if EITHER the IP or the deviceId has played within the
 * window. Keying both jointly would let a user bypass simply by clearing
 * localStorage (changes deviceId) or rotating IP.
 */
export async function checkPublicFreeCooldown(
  ip: string,
  deviceId: string,
  now: Date = new Date(),
): Promise<CooldownStatus> {
  const cutoff = new Date(now.getTime() - PUBLIC_FREE_COOLDOWN_MS);
  const rows = await db
    .select()
    .from(publicFreeCooldownsTable)
    .where(
      or(
        eq(publicFreeCooldownsTable.ip, ip),
        eq(publicFreeCooldownsTable.deviceId, deviceId),
      ),
    )
    .orderBy(desc(publicFreeCooldownsTable.lastGameAt));

  const recent = rows.find((r) => r.lastGameAt >= cutoff);
  if (!recent) return { allowed: true, remainingMs: 0 };
  const elapsed = now.getTime() - recent.lastGameAt.getTime();
  return { allowed: false, remainingMs: PUBLIC_FREE_COOLDOWN_MS - elapsed };
}

export async function recordPublicFreeGame(
  ip: string,
  deviceId: string,
  now: Date = new Date(),
): Promise<void> {
  // Upsert by (ip, deviceId) composite primary key — touching both columns so
  // either one matching on the next request triggers the cooldown.
  await db
    .insert(publicFreeCooldownsTable)
    .values({ ip, deviceId, lastGameAt: now })
    .onConflictDoUpdate({
      target: [publicFreeCooldownsTable.ip, publicFreeCooldownsTable.deviceId],
      set: { lastGameAt: now },
    });
  // Touch usage timestamps for any older rows that share IP or deviceId so the
  // window stays sticky even if the user rotates the OTHER key next time.
  await db
    .update(publicFreeCooldownsTable)
    .set({ lastGameAt: now })
    .where(
      or(
        eq(publicFreeCooldownsTable.ip, ip),
        eq(publicFreeCooldownsTable.deviceId, deviceId),
      ),
    );
}
