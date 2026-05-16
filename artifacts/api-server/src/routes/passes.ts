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
import { issuePass } from "../lib/passes";
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

/** Discount-code redemption — does NOT touch the payment provider. */
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
  const [discount] = await db
    .select()
    .from(discountCodesTable)
    .where(eq(discountCodesTable.code, code))
    .limit(1);

  if (!discount) {
    res.json(RedeemDiscountCodeResponse.parse({ success: false, message: "Invalid code" }));
    return;
  }
  if (discount.expiresAt && discount.expiresAt < new Date()) {
    res.json(RedeemDiscountCodeResponse.parse({ success: false, message: "Code expired" }));
    return;
  }

  // One redemption per user per code.
  const [already] = await db
    .select()
    .from(discountRedemptionsTable)
    .where(
      and(
        eq(discountRedemptionsTable.code, code),
        eq(discountRedemptionsTable.userId, user.id),
      ),
    )
    .limit(1);
  if (already) {
    res.json(
      RedeemDiscountCodeResponse.parse({
        success: false,
        message: "You've already redeemed this code",
      }),
    );
    return;
  }

  // Atomically claim a redemption slot — the WHERE clause prevents concurrent
  // redeems from pushing past the cap.
  const claim = await db
    .update(discountCodesTable)
    .set({ redemptionCount: sql`${discountCodesTable.redemptionCount} + 1` })
    .where(
      and(
        eq(discountCodesTable.code, code),
        sql`(${discountCodesTable.maxRedemptions} IS NULL OR ${discountCodesTable.redemptionCount} < ${discountCodesTable.maxRedemptions})`,
      ),
    )
    .returning({ id: discountCodesTable.code });
  if (claim.length === 0) {
    res.json(
      RedeemDiscountCodeResponse.parse({ success: false, message: "Code fully redeemed" }),
    );
    return;
  }

  const pass = await issuePass({
    userId: user.id,
    kind: discount.grantsPassKind as PassKind,
    source: "discount_code",
    sourceRef: code,
  });
  await db.insert(discountRedemptionsTable).values({
    id: newId(),
    code,
    userId: user.id,
    passId: pass.id,
  });

  req.log.info({ userId: user.id, code, passKind: pass.kind }, "Discount code redeemed");
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
  const pass = await issuePass({
    userId: user.id,
    kind: verify.kind,
    source: "purchase",
    sourceRef: verify.providerRef,
  });
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
