import { eq, gt, or } from "drizzle-orm";
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
 * Cooldown blocks if EITHER the IP or the deviceId has an unexpired
 * `cooldownUntil` row. Joining both keys protects against bypasses via
 * localStorage clearing (rotates deviceId) or IP rotation alone.
 */
export async function checkPublicFreeCooldown(
  ip: string,
  deviceId: string,
  now: Date = new Date(),
): Promise<CooldownStatus> {
  const rows = await db
    .select()
    .from(publicFreeCooldownsTable)
    .where(
      or(
        eq(publicFreeCooldownsTable.ip, ip),
        eq(publicFreeCooldownsTable.deviceId, deviceId),
      ),
    );
  let latest: Date | null = null;
  for (const r of rows) {
    if (r.cooldownUntil > now && (!latest || r.cooldownUntil > latest)) {
      latest = r.cooldownUntil;
    }
  }
  if (!latest) return { allowed: true, remainingMs: 0 };
  return { allowed: false, remainingMs: latest.getTime() - now.getTime() };
}

/**
 * Record a cooldown for the public free tier. Called at game END (not start)
 * so the cooldown reflects "just used your free game" rather than "started
 * one and may have abandoned it".
 */
export async function recordPublicFreeGameEnd(
  ip: string,
  deviceId: string,
  now: Date = new Date(),
): Promise<void> {
  const cooldownUntil = new Date(now.getTime() + PUBLIC_FREE_COOLDOWN_MS);
  // Upsert by (ip, deviceId).
  await db
    .insert(publicFreeCooldownsTable)
    .values({ ip, deviceId, cooldownUntil })
    .onConflictDoUpdate({
      target: [publicFreeCooldownsTable.ip, publicFreeCooldownsTable.deviceId],
      set: { cooldownUntil },
    });
  // Push the cooldown forward on any sibling rows that share IP or deviceId,
  // so rotating one of the two keys won't dodge the cooldown.
  await db
    .update(publicFreeCooldownsTable)
    .set({ cooldownUntil })
    .where(
      or(
        eq(publicFreeCooldownsTable.ip, ip),
        eq(publicFreeCooldownsTable.deviceId, deviceId),
      ),
    );
  // suppress unused-import warning when only one helper is used elsewhere
  void gt;
}
