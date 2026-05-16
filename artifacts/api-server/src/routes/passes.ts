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
} from "@workspace/api-zod";
import { getOrCreateUser } from "../lib/auth";
import { issuePassTx } from "../lib/passes";
import { paymentProvider } from "../lib/paymentProvider";
import { newId } from "../lib/ids";

const router: IRouter = Router();

function passToSummary(pass: { kind: string; startedAt: Date; durationSeconds: number }) {
  return {
    kind: pass.kind as PassKind,
    startedAt: pass.startedAt,
    expiresAt: new Date(pass.startedAt.getTime() + pass.durationSeconds * 1000),
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

  type Pass = { kind: string; startedAt: Date; durationSeconds: number };

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

export default router;
