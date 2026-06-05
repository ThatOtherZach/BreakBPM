import { Router, type IRouter } from "express";
import { and, eq, ne } from "drizzle-orm";
import { getAddress, formatUnits } from "viem";
import {
  db,
  cryptoOrdersTable,
  passesTable,
  type PassKind,
  type CryptoAsset,
} from "@workspace/db";
import {
  CreateCryptoQuoteBody,
  CreateCryptoQuoteResponse,
  VerifyCryptoPaymentBody,
  VerifyCryptoPaymentResponse,
} from "@workspace/api-zod";
import { getOrCreateUser } from "../lib/auth";
import { grantPurchasedPassTx } from "../lib/passes";
import { stopRenewingStripeSubscriptions } from "../lib/paymentProvider";
import { newId } from "../lib/ids";
import { CRYPTO_PASS_PLANS } from "../lib/pricing";
import {
  cryptoPaymentsEnabled,
  CRYPTO_PAYMENTS_OFF_MESSAGE,
} from "../lib/config";
import {
  cryptoConfigured,
  getNetworkConfig,
  getReceivingAddress,
  getQuoteTtlSeconds,
  readEthUsd,
  usdcAtomicAmount,
  ethWeiAmount,
  verifyPayment,
  verifyPayerSignature,
} from "../lib/cryptoChain";

const router: IRouter = Router();

const LIFETIME_EXPIRES_AT = new Date("9999-12-31T23:59:59.999Z");

function passToSummary(pass: {
  kind: string;
  startedAt: Date;
  durationSeconds: number | null;
}) {
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
 * Quote a one-time pass for on-chain payment. We snapshot the exact atomic
 * amount (and, for ETH, the locked oracle price) into a crypto_orders row so
 * verification later compares against a fixed target the client also used to
 * build the transaction.
 */
router.post("/crypto/quote", async (req, res): Promise<void> => {
  const parsed = CreateCryptoQuoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to pay with crypto" });
    return;
  }
  if (!cryptoConfigured(cryptoPaymentsEnabled())) {
    res.json(
      CreateCryptoQuoteResponse.parse({
        success: false,
        message: CRYPTO_PAYMENTS_OFF_MESSAGE,
      }),
    );
    return;
  }

  let payerAddress: `0x${string}`;
  try {
    payerAddress = getAddress(parsed.data.payerAddress);
  } catch {
    res.json(
      CreateCryptoQuoteResponse.parse({
        success: false,
        message: "That doesn't look like a valid wallet address.",
      }),
    );
    return;
  }

  const plan = CRYPTO_PASS_PLANS.find((p) => p.passKind === parsed.data.passKind);
  if (!plan) {
    res.json(
      CreateCryptoQuoteResponse.parse({
        success: false,
        message: "Unknown pass.",
      }),
    );
    return;
  }

  // Prove the caller controls payerAddress before we bind a quote to it. Without
  // this, anyone could quote a victim's address and race to claim the victim's
  // public on-chain payment (fixed receiving address + USDC amounts).
  const sigOk = await verifyPayerSignature({
    payerAddress,
    passKind: plan.passKind,
    asset: parsed.data.asset,
    issuedAt: parsed.data.issuedAt,
    signature: parsed.data.signature,
  });
  if (!sigOk) {
    res.json(
      CreateCryptoQuoteResponse.parse({
        success: false,
        message:
          "Couldn't verify wallet ownership — reconnect your wallet and try again.",
      }),
    );
    return;
  }

  const cfg = getNetworkConfig();
  const receivingAddress = getReceivingAddress();
  if (!receivingAddress) {
    res.json(
      CreateCryptoQuoteResponse.parse({
        success: false,
        message: CRYPTO_PAYMENTS_OFF_MESSAGE,
      }),
    );
    return;
  }

  const asset = parsed.data.asset as CryptoAsset;
  let expectedAmount: bigint;
  let decimals: number;
  let tokenAddress: string | null;
  let ethUsdRaw: string | null = null;
  let symbol: string;

  try {
    if (asset === "usdc") {
      decimals = cfg.usdcDecimals;
      expectedAmount = usdcAtomicAmount(plan.priceCents, decimals);
      tokenAddress = cfg.usdcAddress;
      symbol = "USDC";
    } else {
      const eth = await readEthUsd();
      decimals = 18;
      expectedAmount = ethWeiAmount(plan.priceCents, eth);
      tokenAddress = null;
      ethUsdRaw = eth.raw.toString();
      symbol = "ETH";
    }
  } catch (err) {
    req.log.error({ err }, "Crypto quote price read failed");
    res.json(
      CreateCryptoQuoteResponse.parse({
        success: false,
        message: "Couldn't fetch a live price just now — try again in a moment.",
      }),
    );
    return;
  }

  const id = newId();
  const expiresAt = new Date(Date.now() + getQuoteTtlSeconds() * 1000);

  await db.insert(cryptoOrdersTable).values({
    id,
    userId: user.id,
    passKind: plan.passKind,
    asset,
    network: cfg.network,
    chainId: cfg.chainId,
    receivingAddress,
    payerAddress: payerAddress.toLowerCase(),
    tokenAddress,
    expectedAmount: expectedAmount.toString(),
    priceCents: plan.priceCents,
    ethUsdRaw,
    status: "pending",
    expiresAt,
  });

  res.json(
    CreateCryptoQuoteResponse.parse({
      success: true,
      message: "Quote ready.",
      order: {
        id,
        passKind: plan.passKind,
        asset,
        network: cfg.network,
        chainId: cfg.chainId,
        receivingAddress,
        tokenAddress,
        expectedAmount: expectedAmount.toString(),
        decimals,
        displayAmount: `${formatUnits(expectedAmount, decimals)} ${symbol}`,
        priceCents: plan.priceCents,
        expiresAt,
      },
    }),
  );
});

/**
 * Verify an on-chain payment and grant the pass. Idempotent: the grant is
 * deduped on passes.source_ref = txHash, and a unique index forbids one tx
 * settling two orders. Doubles as a manual recovery path (re-submit a hash).
 */
router.post("/crypto/verify", async (req, res): Promise<void> => {
  const parsed = VerifyCryptoPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to verify a payment" });
    return;
  }
  if (!cryptoConfigured(cryptoPaymentsEnabled())) {
    res.json(
      VerifyCryptoPaymentResponse.parse({
        success: false,
        status: "failed",
        message: CRYPTO_PAYMENTS_OFF_MESSAGE,
      }),
    );
    return;
  }

  const [order] = await db
    .select()
    .from(cryptoOrdersTable)
    .where(
      and(
        eq(cryptoOrdersTable.id, parsed.data.orderId),
        eq(cryptoOrdersTable.userId, user.id),
      ),
    )
    .limit(1);
  if (!order) {
    res.json(
      VerifyCryptoPaymentResponse.parse({
        success: false,
        status: "failed",
        message: "We couldn't find that order.",
      }),
    );
    return;
  }

  // Already settled — return the granted pass idempotently.
  if (order.status === "paid" && order.passId) {
    const [pass] = await db
      .select()
      .from(passesTable)
      .where(eq(passesTable.id, order.passId))
      .limit(1);
    res.json(
      VerifyCryptoPaymentResponse.parse({
        success: true,
        status: "granted",
        message: "This payment was already confirmed — you're all set.",
        pass: pass ? passToSummary(pass) : undefined,
      }),
    );
    return;
  }

  const txHash = parsed.data.txHash.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
    res.json(
      VerifyCryptoPaymentResponse.parse({
        success: false,
        status: "failed",
        message: "That doesn't look like a valid transaction hash.",
      }),
    );
    return;
  }

  // The active chain must still match the one this order was quoted on, or the
  // locked amount/oracle assumptions no longer hold.
  if (order.chainId !== getNetworkConfig().chainId) {
    res.json(
      VerifyCryptoPaymentResponse.parse({
        success: false,
        status: "failed",
        message: "The payment network changed — please start a new quote.",
      }),
    );
    return;
  }

  // Replay guard: a hash already bound to a different order can't be reused.
  const [clash] = await db
    .select({ id: cryptoOrdersTable.id })
    .from(cryptoOrdersTable)
    .where(
      and(
        eq(cryptoOrdersTable.txHash, txHash),
        ne(cryptoOrdersTable.id, order.id),
      ),
    )
    .limit(1);
  if (clash) {
    res.json(
      VerifyCryptoPaymentResponse.parse({
        success: false,
        status: "mismatch",
        message: "That transaction was already used for another order.",
      }),
    );
    return;
  }

  const ethExpired =
    order.asset === "eth" && order.expiresAt.getTime() < Date.now();

  const outcome = await verifyPayment({
    txHash,
    asset: order.asset as CryptoAsset,
    receivingAddress: getAddress(order.receivingAddress),
    payerAddress: getAddress(order.payerAddress),
    tokenAddress: order.tokenAddress
      ? getAddress(order.tokenAddress)
      : null,
    expectedAmount: BigInt(order.expectedAmount),
  });

  if (outcome.status === "not_found") {
    // No payment on-chain and the ETH price-lock window has passed → expire the
    // quote so the user re-quotes at a fresh price rather than paying a stale
    // (possibly underpriced) wei amount. USDC is a fixed USD price, so it never
    // expires (keeps manual recovery working anytime).
    if (ethExpired) {
      await db
        .update(cryptoOrdersTable)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(cryptoOrdersTable.id, order.id));
      res.json(
        VerifyCryptoPaymentResponse.parse({
          success: false,
          status: "expired",
          message:
            "This ETH quote expired — start a new one to lock a fresh price.",
        }),
      );
      return;
    }
    res.json(
      VerifyCryptoPaymentResponse.parse({
        success: false,
        status: "not_found",
        message: "We haven't seen that transaction yet — give it a moment.",
      }),
    );
    return;
  }
  if (outcome.status === "pending") {
    res.json(
      VerifyCryptoPaymentResponse.parse({
        success: false,
        status: "pending",
        message: `Confirming… ${outcome.confirmations}/${outcome.needed} confirmations.`,
        confirmations: outcome.confirmations,
        needed: outcome.needed,
      }),
    );
    return;
  }
  if (outcome.status === "mismatch") {
    res.json(
      VerifyCryptoPaymentResponse.parse({
        success: false,
        status: "mismatch",
        message: outcome.reason,
      }),
    );
    return;
  }
  if (outcome.status === "failed") {
    res.json(
      VerifyCryptoPaymentResponse.parse({
        success: false,
        status: "failed",
        message: outcome.reason,
      }),
    );
    return;
  }

  // ETH price-lock enforcement, judged by when the payment actually LANDED
  // (block timestamp) rather than when it's verified — so an on-time payment
  // confirmed slightly late is still honored, while a payment that landed after
  // the lock window is rejected regardless of order status (no second-call
  // bypass). blockTimestamp === 0 means we couldn't read the block; fall back to
  // honoring (the tx is mined + confirmed, which is the stronger signal).
  if (
    order.asset === "eth" &&
    outcome.blockTimestamp > 0 &&
    outcome.blockTimestamp * 1000 > order.expiresAt.getTime()
  ) {
    await db
      .update(cryptoOrdersTable)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(cryptoOrdersTable.id, order.id));
    res.json(
      VerifyCryptoPaymentResponse.parse({
        success: false,
        status: "expired",
        message:
          "This ETH payment landed after the quote expired — start a new quote.",
      }),
    );
    return;
  }

  // Granted — issue the pass and settle the order in one transaction. The grant
  // is idempotent on the tx hash; Lifetime's local subscription mutual-exclusion
  // is applied inside grantPurchasedPassTx.
  let pass;
  let deduped;
  try {
    ({ pass, deduped } = await db.transaction(async (tx) => {
      const grant = await grantPurchasedPassTx(tx, {
        userId: user.id,
        kind: order.passKind as PassKind,
        sourceRef: txHash,
      });
      await tx
        .update(cryptoOrdersTable)
        .set({
          status: "paid",
          txHash,
          passId: grant.pass.id,
          updatedAt: new Date(),
        })
        .where(eq(cryptoOrdersTable.id, order.id));
      return grant;
    }));
  } catch (e) {
    // Unique-index race: the same tx settled another order between our check
    // and the write.
    if ((e as { code?: string }).code === "23505") {
      res.json(
        VerifyCryptoPaymentResponse.parse({
          success: false,
          status: "mismatch",
          message: "That transaction was already used for another order.",
        }),
      );
      return;
    }
    req.log.error({ err: e, orderId: order.id }, "Crypto grant failed");
    res.status(500).json({ error: "Could not grant the pass" });
    return;
  }

  // First-time Lifetime also stops a real Stripe subscription from renewing
  // (best-effort, outside the tx). Skipped on dedup.
  if (pass.kind === "lifetime" && !deduped) {
    await stopRenewingStripeSubscriptions(user.id);
  }

  req.log.info(
    { userId: user.id, kind: pass.kind, orderId: order.id, deduped },
    "Crypto payment verified",
  );
  res.json(
    VerifyCryptoPaymentResponse.parse({
      success: true,
      status: "granted",
      message: `Paid — your ${pass.kind} pass is active!`,
      pass: passToSummary(pass),
    }),
  );
});

export default router;
