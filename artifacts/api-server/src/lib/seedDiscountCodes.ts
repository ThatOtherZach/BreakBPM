import { db, discountCodesTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Admin-issued lifetime discount codes. These are seeded by hand (not via the
 * user gift-code flow) and must exist in every environment the server boots in.
 *
 * Production data is NOT copied at deploy time — only schema is. Without this
 * idempotent boot-time seed, codes created in the dev database never reach
 * production. The insert is `ON CONFLICT DO NOTHING`, so re-running it (every
 * boot, or after a code is already present/redeemed) is a safe no-op and never
 * resurrects or resets a code that already exists.
 */
const ADMIN_DISCOUNT_CODES: {
  code: string;
  grantsPassKind: "day" | "year" | "lifetime";
  maxRedemptions: number | null;
}[] = [
  { code: "LIFE-A7BHS2", grantsPassKind: "lifetime", maxRedemptions: 1 },
  { code: "LIFE-NAZXD2", grantsPassKind: "lifetime", maxRedemptions: 1 },
  { code: "LIFE-JNMK9N", grantsPassKind: "lifetime", maxRedemptions: 1 },
  { code: "LIFE-CNPT3S", grantsPassKind: "lifetime", maxRedemptions: 1 },
  { code: "LIFE-Q5VTHT", grantsPassKind: "lifetime", maxRedemptions: 1 },
  { code: "BREAKBPM-LIFETIME", grantsPassKind: "lifetime", maxRedemptions: 100 },
];

export async function seedAdminDiscountCodes(): Promise<void> {
  try {
    const inserted = await db
      .insert(discountCodesTable)
      .values(ADMIN_DISCOUNT_CODES)
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
