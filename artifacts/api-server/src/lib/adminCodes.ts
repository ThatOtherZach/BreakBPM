import { randomBytes } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, discountCodesTable, type PassKind } from "@workspace/db";

/**
 * Admin-issued comp codes. Unlike the Day-Pass gift flow (one live single-use
 * code per issuer, 12h cooldown, 24h expiry), admin codes:
 *   - grant any pass tier the admin picks (day | twoweek | month | year | lifetime),
 *   - carry a chosen redemption cap,
 *   - never expire (expiresAt = NULL), and
 *   - are tagged `issuerKind = 'admin'` so the gift flow never touches them.
 *
 * Authorization (the caller is on BREAKBPM_ADMIN_EMAILS) is enforced by the
 * route — this library trusts its inputs.
 */

/** Confusable-free alphabet (no 0/O/1/I) for friendly hand-typed codes. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;
const CODE_PREFIX = "BB-";

function randomCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return `${CODE_PREFIX}${out}`;
}

/** Tiers an admin code may grant. Excludes the Lucky Break draw kind. */
export const ADMIN_GRANTABLE_KINDS: readonly PassKind[] = [
  "day",
  "twoweek",
  "month",
  "year",
  "lifetime",
];

export interface AdminCodeSummary {
  code: string;
  grantsPassKind: PassKind;
  maxRedemptions: number | null;
  redemptionCount: number;
  createdAt: Date;
}

/**
 * Mint a new admin comp code. Retries on the (astronomically unlikely) PK
 * collision so we never surface a 500 for a transient duplicate.
 */
export async function createAdminDiscountCode(input: {
  issuedByUserId: string;
  kind: PassKind;
  maxRedemptions: number | null;
}): Promise<AdminCodeSummary> {
  const now = new Date();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      const [row] = await db
        .insert(discountCodesTable)
        .values({
          code,
          grantsPassKind: input.kind,
          maxRedemptions: input.maxRedemptions,
          issuedByUserId: input.issuedByUserId,
          issuedAt: now,
          issuerKind: "admin",
        })
        .returning();
      return {
        code: row.code,
        grantsPassKind: row.grantsPassKind as PassKind,
        maxRedemptions: row.maxRedemptions,
        redemptionCount: row.redemptionCount,
        createdAt: row.createdAt,
      };
    } catch (e) {
      // drizzle can wrap the pg error, so the SQLSTATE may sit on the cause.
      const sqlState =
        (e as { code?: string }).code ??
        (e as { cause?: { code?: string } }).cause?.code;
      if (sqlState === "23505") continue; // PK collision → retry
      throw e;
    }
  }
  throw new Error("Could not mint a unique admin code after several attempts.");
}

/** Most-recent-first list of the comp codes this admin minted. */
export async function listAdminDiscountCodes(
  userId: string,
  limit = 20,
): Promise<AdminCodeSummary[]> {
  const rows = await db
    .select({
      code: discountCodesTable.code,
      grantsPassKind: discountCodesTable.grantsPassKind,
      maxRedemptions: discountCodesTable.maxRedemptions,
      redemptionCount: discountCodesTable.redemptionCount,
      createdAt: discountCodesTable.createdAt,
    })
    .from(discountCodesTable)
    .where(
      and(
        eq(discountCodesTable.issuedByUserId, userId),
        eq(discountCodesTable.issuerKind, "admin"),
      ),
    )
    .orderBy(desc(discountCodesTable.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    code: r.code,
    grantsPassKind: r.grantsPassKind as PassKind,
    maxRedemptions: r.maxRedemptions,
    redemptionCount: r.redemptionCount,
    createdAt: r.createdAt,
  }));
}
