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

  type Outcome =
    | { ok: true; pass: { kind: string; startedAt: Date; durationSeconds: number } }
    | { ok: false; message: string };

  let outcome: Outcome;
  try {
    outcome = await db.transaction(async (tx): Promise<Outcome> => {
      const [discount] = await tx
        .select()
        .from(discountCodesTable)
        .where(eq(discountCodesTable.code, code))
        .for("update")
        .limit(1);
      if (!discount) return { ok: false, message: "Invalid code" };
      if (discount.expiresAt && discount.expiresAt < new Date()) {
        return { ok: false, message: "Code expired" };
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
      if (claim.length === 0) return { ok: false, message: "Code fully redeemed" };

      // Issue pass + record redemption inside the same tx. The unique
      // (code, user_id) index makes the INSERT throw on a concurrent
      // double-redeem, which rolls back both writes — no orphan pass row.
      const pass = await issuePassTx(tx, {
        userId: user.id,
        kind: discount.grantsPassKind as PassKind,
        source: "discount_code",
        sourceRef: code,
      });
      try {
        await tx.insert(discountRedemptionsTable).values({
          id: newId(),
          code,
          userId: user.id,
          passId: pass.id,
        });
      } catch (e) {
        // Translate the unique-violation into a friendly message. Any other
        // error keeps propagating and rolls back the tx as expected.
        const code = (e as { code?: string }).code;
        if (code === "23505") {
          return { ok: false, message: "You've already redeemed this code" };
        }
        throw e;
      }
      return { ok: true, pass };
    });
  } catch (err) {
    req.log.error({ err, code, userId: user.id }, "Redeem failed");
    res.status(500).json({ error: "Redeem failed" });
    return;
  }

  if (!outcome.ok) {
    res.json(RedeemDiscountCodeResponse.parse({ success: false, message: outcome.message }));
    return;
  }

  req.log.info(
    { userId: user.id, code, passKind: outcome.pass.kind },
    "Discount code redeemed",
  );
  res.json(
    RedeemDiscountCodeResponse.parse({
      success: true,
      message: `Granted ${outcome.pass.kind} pass`,
      pass: passToSummary(outcome.pass),
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
