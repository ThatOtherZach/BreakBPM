import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  db,
  discountCodesTable,
  discountRedemptionsTable,
} from "@workspace/db";
import { getActivePasses } from "./entitlement";

/**
 * Pass-holder Day-Pass gift flow. Year/Lifetime holders can mint a single-use
 * Day Pass code every 12 hours; the code lives for 24h and is superseded the
 * moment a new one is minted (the previous unused code's expiresAt is
 * stamped to now).
 *
 * Cooldown is purely generation-based — redemption / expiry / regeneration
 * of the previous code does NOT reset it. One code per 12 hours, full stop.
 */
export const GIFT_COOLDOWN_MS = 12 * 60 * 60 * 1000;
export const GIFT_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Issuer must hold one of these kinds of active passes. */
const ELIGIBLE_KINDS = new Set(["year", "lifetime"]);

/** Confusable-free alphabet (no 0/O/1/I) for friendly hand-typed codes. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE_PREFIX = "GIFT-";

function randomCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return CODE_PREFIX + out;
}

export class GiftCodeFailure extends Error {
  constructor(
    public readonly reason: "not_eligible" | "cooldown_active" | "exhausted_attempts",
    message: string,
    public readonly cooldownRemainingMs?: number,
  ) {
    super(message);
  }
}

export interface GiftCodeSummary {
  code: string;
  grantsPassKind: "day" | "year" | "lifetime";
  issuedAt: Date;
  expiresAt: Date;
  redeemed: boolean;
  expired: boolean;
}

interface GenerateResult {
  code: GiftCodeSummary;
  nextAvailableAt: Date;
}

/**
 * Generate a new Day-Pass gift code for `userId`. Throws GiftCodeFailure on
 * the user-visible rejection paths (no qualifying pass / on cooldown) so the
 * route handler can map them to a structured response without leaking 500s.
 */
export async function generateGiftCode(userId: string): Promise<GenerateResult> {
  // Eligibility check runs outside the transaction — pass state is read-mostly
  // and we want a clear, fast 4xx-style rejection before opening a write tx.
  // Uses a wall-clock `now` only for this read; the canonical timestamp used
  // for cooldown math is captured AFTER the advisory lock below so contended
  // callers don't get a false cooldown rejection for time spent waiting.
  const eligibilityNow = new Date();
  const active = await getActivePasses(userId, eligibilityNow);
  if (!active.some((p) => ELIGIBLE_KINDS.has(p.kind))) {
    throw new GiftCodeFailure(
      "not_eligible",
      "Only Year and Lifetime pass holders can gift a Day Pass.",
    );
  }

  return await db.transaction(async (tx) => {
    // Serialize concurrent generations from the same issuer so two
    // double-clicks can't sneak past the cooldown check together.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);

    // Capture `now` after the lock is held so any time spent waiting on a
    // contended lock counts toward (rather than against) the cooldown.
    const now = new Date();

    const [lastRow] = await tx
      .select({ issuedAt: discountCodesTable.issuedAt })
      .from(discountCodesTable)
      .where(eq(discountCodesTable.issuedByUserId, userId))
      .orderBy(desc(discountCodesTable.issuedAt))
      .limit(1);

    const lastIssuedAt = lastRow?.issuedAt ?? null;
    if (lastIssuedAt) {
      const remaining = GIFT_COOLDOWN_MS - (now.getTime() - lastIssuedAt.getTime());
      if (remaining > 0) {
        throw new GiftCodeFailure(
          "cooldown_active",
          "You can gift another Day Pass once your 12-hour cooldown ends.",
          remaining,
        );
      }
    }

    // Supersede any prior unused, still-live gift code from this issuer.
    await tx
      .update(discountCodesTable)
      .set({ expiresAt: now })
      .where(
        and(
          eq(discountCodesTable.issuedByUserId, userId),
          eq(discountCodesTable.redemptionCount, 0),
          or(isNull(discountCodesTable.expiresAt), gt(discountCodesTable.expiresAt, now)),
        ),
      );

    const expiresAt = new Date(now.getTime() + GIFT_EXPIRY_MS);

    // PK collision is extremely unlikely (32^8 ≈ 1e12 codes) but retry a few
    // times before giving up so we never bubble a 500 to the user.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      try {
        await tx.insert(discountCodesTable).values({
          code,
          grantsPassKind: "day",
          maxRedemptions: 1,
          expiresAt,
          issuedByUserId: userId,
          issuedAt: now,
        });
        return {
          code: {
            code,
            grantsPassKind: "day",
            issuedAt: now,
            expiresAt,
            redeemed: false,
            expired: false,
          },
          nextAvailableAt: new Date(now.getTime() + GIFT_COOLDOWN_MS),
        };
      } catch (e) {
        if ((e as { code?: string }).code === "23505") continue; // PK collision → retry
        throw e;
      }
    }
    throw new GiftCodeFailure(
      "exhausted_attempts",
      "Could not mint a unique code right now. Please try again.",
    );
  });
}

export interface ListResult {
  eligible: boolean;
  codes: GiftCodeSummary[];
  cooldownActive: boolean;
  nextAvailableAt: Date | null;
}

/**
 * Return the issuer's most recent gift codes plus their cooldown state. The
 * cooldown is independent of whether the listed codes are redeemed or
 * expired — it's purely based on the most recent issuance time.
 */
export async function listMyGiftCodes(userId: string, limit = 5): Promise<ListResult> {
  const now = new Date();

  const active = await getActivePasses(userId, now);
  const eligible = active.some((p) => ELIGIBLE_KINDS.has(p.kind));

  const rows = await db
    .select({
      code: discountCodesTable.code,
      grantsPassKind: discountCodesTable.grantsPassKind,
      issuedAt: discountCodesTable.issuedAt,
      expiresAt: discountCodesTable.expiresAt,
      redemptionCount: discountCodesTable.redemptionCount,
    })
    .from(discountCodesTable)
    .where(eq(discountCodesTable.issuedByUserId, userId))
    .orderBy(desc(discountCodesTable.issuedAt))
    .limit(limit);

  const codes: GiftCodeSummary[] = rows.map((r) => ({
    code: r.code,
    grantsPassKind: r.grantsPassKind as "day" | "year" | "lifetime",
    issuedAt: r.issuedAt ?? new Date(0),
    expiresAt: r.expiresAt ?? new Date(0),
    redeemed: r.redemptionCount > 0,
    expired: r.expiresAt ? r.expiresAt.getTime() <= now.getTime() : true,
  }));

  const lastIssuedAt = codes[0]?.issuedAt ?? null;
  const nextAvailableAt = lastIssuedAt
    ? new Date(lastIssuedAt.getTime() + GIFT_COOLDOWN_MS)
    : null;
  const cooldownActive = nextAvailableAt ? nextAvailableAt.getTime() > now.getTime() : false;

  return { eligible, codes, cooldownActive, nextAvailableAt };
}

