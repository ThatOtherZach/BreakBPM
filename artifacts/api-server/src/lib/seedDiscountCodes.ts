import { db, discountCodesTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Admin-issued comp/lifetime discount codes, configured entirely via the
 * BREAKBPM_COMP_CODES environment value (shared across dev + prod). Keeping the
 * codes in an env value — rather than a hardcoded source array — means new comp
 * codes can be added or shared without a code change or redeploy, and the codes
 * (redeemable bearer tokens) stay out of git.
 *
 * Production data is NOT copied at deploy time — only schema is. Without this
 * idempotent boot-time seed, codes never reach production. The insert is
 * `ON CONFLICT DO NOTHING`, so re-running it (every boot, or after a code is
 * already present/redeemed) is a safe no-op and never resurrects or resets a
 * code that already exists. To raise a code's cap, update the existing row
 * directly — the seed will not overwrite it.
 *
 * Format: comma-separated entries, each `code:kind[:maxRedemptions]`.
 *   - `code`  — the redeemable string (e.g. `LIFE-A7BHS2`). Stored uppercased
 *     to match /passes/redeem, which uppercases user input before lookup — a
 *     lowercase entry would otherwise seed but be impossible to redeem.
 *   - `kind`  — one of `day` | `year` | `lifetime`
 *   - `maxRedemptions` — optional positive integer; omit (or leave blank) for
 *     unlimited. Whitespace around entries/fields is tolerated.
 *
 * Example:
 *   LIFE-A7BHS2:lifetime:1, BREAKBPM-LIFETIME:lifetime:500
 */

const VALID_KINDS = new Set(["day", "year", "lifetime"]);

interface SeedCode {
  code: string;
  grantsPassKind: "day" | "year" | "lifetime";
  maxRedemptions: number | null;
}

/**
 * Parse the BREAKBPM_COMP_CODES value into seedable rows. Malformed entries are
 * skipped (with a warning) rather than crashing startup, so one bad entry can
 * never block the rest from seeding.
 */
export function parseCompCodes(raw: string | undefined): SeedCode[] {
  if (!raw || !raw.trim()) return [];
  const rows: SeedCode[] = [];
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const fields = trimmed.split(":").map((p) => p.trim());
    const [codePart, kindPart, maxPart] = fields;
    // Uppercase so codes match /passes/redeem (which uppercases user input).
    const code = (codePart ?? "").toUpperCase();
    const kind = (kindPart ?? "").toLowerCase();
    if (!code || !VALID_KINDS.has(kind) || fields.length > 3) {
      // Don't log the raw entry — it contains the redeemable code.
      logger.warn("Skipping malformed BREAKBPM_COMP_CODES entry");
      continue;
    }
    let maxRedemptions: number | null = null;
    if (maxPart) {
      const parsed = Number(maxPart);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        logger.warn("Skipping BREAKBPM_COMP_CODES entry with invalid maxRedemptions");
        continue;
      }
      maxRedemptions = parsed;
    }
    rows.push({
      code,
      grantsPassKind: kind as "day" | "year" | "lifetime",
      maxRedemptions,
    });
  }
  return rows;
}

export async function seedAdminDiscountCodes(): Promise<void> {
  const codes = parseCompCodes(process.env.BREAKBPM_COMP_CODES);
  if (codes.length === 0) return;
  try {
    const inserted = await db
      .insert(discountCodesTable)
      .values(codes)
      .onConflictDoNothing({ target: discountCodesTable.code })
      .returning({ code: discountCodesTable.code });

    if (inserted.length > 0) {
      // Log a count only — the code strings are redeemable bearer tokens.
      logger.info({ count: inserted.length }, "Seeded admin discount codes");
    }
  } catch (err) {
    // Seeding is best-effort and must never crash startup.
    logger.error({ err }, "Failed to seed admin discount codes");
  }
}
