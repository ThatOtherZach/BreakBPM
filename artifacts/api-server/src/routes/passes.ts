import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  discountCodesTable,
  discountRedemptionsTable,
  type PassKind,
} from "@workspace/db";
import {
  RedeemDiscountCodeBody,
  RedeemDiscountCodeResponse,
  CreatePassCheckoutBody,
  CreatePassCheckoutResponse,
  VerifyPassCheckoutBody,
  VerifyPassCheckoutResponse,
  DevGrantLifetimeResponse,
} from "@workspace/api-zod";
import { getOrCreateUser } from "../lib/auth";
import { issuePassTx } from "../lib/passes";
import { getActivePasses } from "../lib/entitlement";
import { paymentProvider, DEV_FREE_UPGRADE_ENABLED } from "../lib/paymentProvider";
import { newId } from "../lib/ids";

const router: IRouter = Router();

// See entitlement.ts for the canonical lifetime expiry sentinel. We
// duplicate the literal here to keep this helper free of cross-module
// coupling; if you change one, change both.
const LIFETIME_EXPIRES_AT = new Date("9999-12-31T23:59:59.999Z");

function passToSummary(pass: { kind: string; startedAt: Date; durationSeconds: number | null }) {
  return {
    kind: pass.kind as PassKind,
    startedAt: pass.startedAt,
    expiresAt:
      pass.durationSeconds === null
        ? LIFETIME_EXPIRES_AT
        : new Date(pass.startedAt.getTime() + pass.durationSeconds * 1000),
    isLifetime: pass.kind === "lifetime",
  };
}

/**
 * Discount-code redemption — does NOT touch the payment provider.
 *
 * The whole validate / decrement-cap / insert-redemption / issue-pass
 * sequence runs inside a single transaction so the user can never end up
 * with two passes from one code under concurrent requests. The unique
 * (code, user_id) index on discount_redemptions provides the second line
 * of defence — if two transactions race past the SELECT, the loser's
 * INSERT fails and the whole tx rolls back, so no orphan pass row remains.
 */
router.post("/passes/redeem", async (req, res): Promise<void> => {
  const parsed = RedeemDiscountCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to redeem a code" });
    return;
  }

  const code = parsed.data.code.trim().toUpperCase();

  // We use a thrown sentinel for any "validation failed" path INSIDE the
  // transaction so that pg rolls back any writes that already happened
  // (e.g. the cap-claim UPDATE) before we hit the failure. Returning a
  // non-throw result from inside the tx callback would commit those
  // writes, which would leak entitlement state on the duplicate-redeem
  // path.
  class RedeemFailure extends Error {
    constructor(public reason: string) { super(reason); }
  }

  type Pass = { kind: string; startedAt: Date; durationSeconds: number | null };

  let pass: Pass;
  try {
    pass = await db.transaction(async (tx): Promise<Pass> => {
      const [discount] = await tx
        .select()
        .from(discountCodesTable)
        .where(eq(discountCodesTable.code, code))
        .for("update")
        .limit(1);
      if (!discount) throw new RedeemFailure("Invalid code");
      if (discount.expiresAt && discount.expiresAt < new Date()) {
        throw new RedeemFailure("Code expired");
      }

      // Atomic cap claim: this UPDATE only succeeds if the cap allows it.
      const claim = await tx
        .update(discountCodesTable)
        .set({ redemptionCount: sql`${discountCodesTable.redemptionCount} + 1` })
        .where(
          and(
            eq(discountCodesTable.code, code),
            sql`(${discountCodesTable.maxRedemptions} IS NULL OR ${discountCodesTable.redemptionCount} < ${discountCodesTable.maxRedemptions})`,
          ),
        )
        .returning({ id: discountCodesTable.code });
      if (claim.length === 0) throw new RedeemFailure("Code fully redeemed");

      const issued = await issuePassTx(tx, {
        userId: user.id,
        kind: discount.grantsPassKind as PassKind,
        source: "discount_code",
        sourceRef: code,
      });

      // Insert the redemption AFTER the pass so we can wire passId
      // correctly. The unique (code, user_id) index catches duplicate
      // redeems; the throw below rolls back BOTH the pass insert and
      // the cap increment so partial entitlement state can never leak.
      try {
        await tx.insert(discountRedemptionsTable).values({
          id: newId(),
          code,
          userId: user.id,
          passId: issued.id,
        });
      } catch (e) {
        if ((e as { code?: string }).code === "23505") {
          throw new RedeemFailure("You've already redeemed this code");
        }
        throw e;
      }
      return issued;
    });
  } catch (err) {
    if (err instanceof RedeemFailure) {
      res.json(RedeemDiscountCodeResponse.parse({ success: false, message: err.reason }));
      return;
    }
    req.log.error({ err, code, userId: user.id }, "Redeem failed");
    res.status(500).json({ error: "Redeem failed" });
    return;
  }

  req.log.info(
    { userId: user.id, code, passKind: pass.kind },
    "Discount code redeemed",
  );
  res.json(
    RedeemDiscountCodeResponse.parse({
      success: true,
      message: `Granted ${pass.kind} pass`,
      pass: passToSummary(pass),
    }),
  );
});

/** Begin a paid checkout. The provider returns an opaque token (and optional URL). */
router.post("/passes/checkout", async (req, res): Promise<void> => {
  const parsed = CreatePassCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to purchase a pass" });
    return;
  }
  const result = await paymentProvider.createCheckout({
    userId: user.id,
    kind: parsed.data.kind,
  });
  res.json(CreatePassCheckoutResponse.parse(result));
});

/** Hand the opaque token back; provider verifies and the pass is granted. */
router.post("/passes/verify", async (req, res): Promise<void> => {
  const parsed = VerifyPassCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to verify a pass" });
    return;
  }
  const verify = await paymentProvider.verifyAndGrant(parsed.data.opaqueToken);
  if (!verify.success || !verify.kind) {
    res.json(VerifyPassCheckoutResponse.parse({ success: false, message: verify.message }));
    return;
  }
  const pass = await db.transaction((tx) =>
    issuePassTx(tx, {
      userId: user.id,
      kind: verify.kind!,
      source: "purchase",
      sourceRef: verify.providerRef,
    }),
  );
  req.log.info({ userId: user.id, kind: pass.kind }, "Pass purchased");
  res.json(
    VerifyPassCheckoutResponse.parse({
      success: true,
      message: verify.message,
      pass: passToSummary(pass),
    }),
  );
});

// TODO(remove-before-launch): dev-only free Lifetime upgrade. Returns 404
// when DEV_FREE_UPGRADE_ENABLED is false so the endpoint disappears for
// production. Rip out together with the flag in paymentProvider.ts and the
// button in AccountScreen.tsx.
router.post("/passes/dev-grant-lifetime", async (req, res): Promise<void> => {
  if (!DEV_FREE_UPGRADE_ENABLED) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in first" });
    return;
  }
  // Race-safe issuance: serialize concurrent requests for the same user via a
  // per-user advisory lock, then re-check inside the same transaction before
  // inserting. Two double-clicks can't both insert a lifetime pass.
  type PassSummaryShape = { kind: string; startedAt: Date; expiresAt: Date; isLifetime: boolean };
  type DevGrantOutcome =
    | { alreadyHad: true; summary: PassSummaryShape }
    | { alreadyHad: false; summary: PassSummaryShape };
  const outcome: DevGrantOutcome = await db.transaction(async (tx): Promise<DevGrantOutcome> => {
    // pg_advisory_xact_lock takes a bigint; hash the user id into one.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`);
    const existing = await getActivePasses(user.id);
    const existingLifetime = existing.find((p) => p.isLifetime);
    if (existingLifetime) return { alreadyHad: true, summary: existingLifetime };
    const issued = await issuePassTx(tx, {
      userId: user.id,
      kind: "lifetime",
      source: "grant",
      sourceRef: "dev_free_upgrade",
    });
    return { alreadyHad: false, summary: passToSummary(issued) };
  });
  if (outcome.alreadyHad) {
    res.json(
      DevGrantLifetimeResponse.parse({
        success: true,
        message: "You already have a Lifetime pass.",
        alreadyHad: true,
        pass: outcome.summary,
      }),
    );
    return;
  }
  req.log.warn(
    { userId: user.id },
    "DEV: free Lifetime pass granted via /passes/dev-grant-lifetime",
  );
  res.json(
    DevGrantLifetimeResponse.parse({
      success: true,
      message: "Lifetime pass granted. Enjoy!",
      alreadyHad: false,
      pass: outcome.summary,
    }),
  );
});

export default router;
