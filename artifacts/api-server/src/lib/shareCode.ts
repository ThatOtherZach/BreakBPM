import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db, gamesTable } from "@workspace/db";

/**
 * Safe 32-char alphabet (Crockford-ish): digits 2–9 + A–Z minus
 * easily-confused glyphs (0, 1, I, O). 5 chars → 32^5 ≈ 33.5M codes.
 */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const SHARE_CODE_LENGTH = 5;

/** Codes are reserved for this long after game end so links don't collide. */
export const SHARE_CODE_REUSE_COOLDOWN_MS = 48 * 60 * 60 * 1000;

/** Canonical form: uppercase, alphabet-only. Returns null if invalid. */
export function normalizeShareCode(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const up = raw.toUpperCase().trim();
  if (up.length !== SHARE_CODE_LENGTH) return null;
  for (let i = 0; i < up.length; i++) {
    if (!ALPHABET.includes(up[i])) return null;
  }
  return up;
}

function randomCode(): string {
  let out = "";
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Generate a 5-char code that doesn't collide with any active game or
 * any game ended within the cooldown window. Retries up to N times,
 * then falls back to whatever we last drew (32^5 collision rate is
 * negligible in practice).
 */
export async function generateUniqueShareCode(): Promise<string> {
  const cutoff = new Date(Date.now() - SHARE_CODE_REUSE_COOLDOWN_MS);
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = randomCode();
    const conflict = await db
      .select({ id: gamesTable.id })
      .from(gamesTable)
      .where(
        and(
          eq(gamesTable.shareCode, candidate),
          or(isNull(gamesTable.endedAt), gt(gamesTable.endedAt, cutoff)),
        ),
      )
      .limit(1);
    if (conflict.length === 0) return candidate;
  }
  return randomCode();
}
