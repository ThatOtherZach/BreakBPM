import { Router, type IRouter } from "express";
import { randomInt } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { getAddress, formatUnits } from "viem";
import {
  db,
  cryptoOrdersTable,
  passesTable,
  luckyBreakRollsTable,
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
import { issuePassTx, grantPurchasedPassTx } from "../lib/passes";
import { stopRenewingActiveSubscriptionsTx } from "../lib/subscriptions";
import { stopRenewingStripeSubscriptions } from "../lib/paymentProvider";
import { newId } from "../lib/ids";
import { CRYPTO_PASS_PLANS } from "../lib/pricing";
import {
  LUCKY_BREAK_CODE_KIND,
  LUCKY_BREAK_WINDOW_DAYS,
  computeLuckyBreakRoll,
} from "../lib/luckyBreak";
import { gatherShotEntropy } from "../lib/luckyBreakEntropy";
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
  findIncomingUsdcTx,
} from "../lib/cryptoChain";

/**
 * A tiny random atomic tail added to a MANUAL order's amount so each one is
 * unique — a single on-chain payment then maps to exactly one order, letting us
 * claim it by amount (and auto-detect USDC) without binding a payer. Kept
 * economically negligible:
 *   - USDC (6dp): 1..9999 base units (< $0.01)
 *   - ETH (18dp): 1..1e12 wei (< $0.01 at any realistic ETH price)
 */
function manualAmountTail(asset: CryptoAsset): bigint {
  if (asset === "usdc") return BigInt(randomInt(1, 10_000));
  return BigInt(randomInt(1, 1_000_000_000_000));
}

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

/** Shape a persisted Lucky Break roll row into the API reveal payload. */
function toLuckyBreakReveal(row: {
  outcome: string;
  lifetimeProbabilityBps: number;
  windowDays: number;
  seedHash: string;
  entropyShotCount: number;
}) {
  return {
    outcome: row.outcome as "month" | "lifetime",
    lifetimeProbability: row.lifetimeProbabilityBps / 10_000,
    windowDays: row.windowDays,
    seedHash: row.seedHash,
    seededShotCount: row.entropyShotCount,
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

  // Two order shapes. If a payerAddress is supplied, this is the connect-wallet
  // shortcut: we must prove the caller controls that address (else anyone could
  // quote a victim's address and race to claim their public on-chain payment),
  // and the settling tx is later required to come from it. With no payerAddress
  // it's a MANUAL order — payable from any wallet (mobile or desktop) and
  // claimed by its unique exact amount instead.
  let payerAddress: string | null = null;
  if (parsed.data.payerAddress !== undefined) {
    let addr: `0x${string}`;
    try {
      addr = getAddress(parsed.data.payerAddress);
    } catch {
      res.json(
        CreateCryptoQuoteResponse.parse({
          success: false,
          message: "That doesn't look like a valid wallet address.",
        }),
      );
      return;
    }
    if (parsed.data.signature === undefined || parsed.data.issuedAt === undefined) {
      res.json(
        CreateCryptoQuoteResponse.parse({
          success: false,
          message:
            "Couldn't verify wallet ownership — reconnect your wallet and try again.",
        }),
      );
      return;
    }
    const sigOk = await verifyPayerSignature({
      payerAddress: addr,
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
    payerAddress = addr.toLowerCase();
  }
  const manual = payerAddress === null;

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
  let baseAmount: bigint;
  let decimals: number;
  let tokenAddress: string | null;
  let ethUsdRaw: string | null = null;
  let symbol: string;

  try {
    if (asset === "usdc") {
      decimals = cfg.usdcDecimals;
      baseAmount = usdcAtomicAmount(plan.priceCents, decimals);
      tokenAddress = cfg.usdcAddress;
      symbol = "USDC";
    } else {
      const eth = await readEthUsd();
      decimals = 18;
      baseAmount = ethWeiAmount(plan.priceCents, eth);
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

  const expiresAt = new Date(Date.now() + getQuoteTtlSeconds() * 1000);

  // Manual orders get a unique exact amount (base + tiny random tail) so a
  // single payment maps to exactly one order. Uniqueness is enforced ATOMICALLY
  // by the partial unique index on (receivingAddress, asset, expectedAmount) for
  // live manual orders: we INSERT with ON CONFLICT DO NOTHING and retry with a
  // fresh tail on collision — so concurrent quotes can never share an amount.
  // Connected orders keep the base amount (they're bound to a payer, so the
  // amount need not be unique) and never conflict on that index.
  const id = newId();
  let expectedAmount = baseAmount;
  let reserved = false;
  const attempts = manual ? 8 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidate = manual ? baseAmount + manualAmountTail(asset) : baseAmount;
    const inserted = await db
      .insert(cryptoOrdersTable)
      .values({
        id,
        userId: user.id,
        passKind: plan.passKind,
        asset,
        network: cfg.network,
        chainId: cfg.chainId,
        receivingAddress,
        payerAddress,
        tokenAddress,
        expectedAmount: candidate.toString(),
        priceCents: plan.priceCents,
        ethUsdRaw,
        status: "pending",
        expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: cryptoOrdersTable.id });
    if (inserted.length > 0) {
      expectedAmount = candidate;
      reserved = true;
      break;
    }
  }
  if (!reserved) {
    res.json(
      CreateCryptoQuoteResponse.parse({
        success: false,
        message: "Couldn't reserve a payment amount just now — please try again.",
      }),
    );
    return;
  }

  res.json(
    CreateCryptoQuoteResponse.parse({
      success: true,
      message: "Quote ready.",
      order: {
        id,
        manual,
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

  // Already settled — return the granted pass idempotently. For a Lucky Break
  // order, also replay the won roll so a resumed/re-verified checkout can still
  // show the reveal (the draw is never re-run; we read the persisted result).
  if (order.status === "paid" && order.passId) {
    const [pass] = await db
      .select()
      .from(passesTable)
      .where(eq(passesTable.id, order.passId))
      .limit(1);
    let luckyBreak;
    if (order.passKind === LUCKY_BREAK_CODE_KIND) {
      const [row] = await db
        .select()
        .from(luckyBreakRollsTable)
        .where(eq(luckyBreakRollsTable.cryptoOrderId, order.id))
        .limit(1);
      if (row) luckyBreak = toLuckyBreakReveal(row);
    }
    res.json(
      VerifyCryptoPaymentResponse.parse({
        success: true,
        status: "granted",
        message: "This payment was already confirmed — you're all set.",
        pass: pass ? passToSummary(pass) : undefined,
        luckyBreak,
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

  // A manual order (no bound payer) is claimed by its unique exact amount, so we
  // can resolve the settling tx ourselves for USDC by scanning recent transfers
  // to our address. ETH emits no transfer logs, so a manual ETH order still
  // needs the user to paste their tx hash.
  const manual = order.payerAddress === null;
  let txHash: string;
  if (parsed.data.txHash !== undefined) {
    txHash = parsed.data.txHash.trim().toLowerCase();
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
  } else if (manual && order.asset === "usdc" && order.tokenAddress) {
    const found = await findIncomingUsdcTx({
      tokenAddress: getAddress(order.tokenAddress),
      receivingAddress: getAddress(order.receivingAddress),
      expectedAmount: BigInt(order.expectedAmount),
      orderAgeSeconds: Math.max(
        0,
        Math.floor((Date.now() - order.createdAt.getTime()) / 1000),
      ),
    });
    if (!found) {
      res.json(
        VerifyCryptoPaymentResponse.parse({
          success: false,
          status: "not_found",
          message: "We haven't seen your payment yet — give it a moment.",
        }),
      );
      return;
    }
    txHash = found;
  } else {
    // Manual ETH (or any order awaiting a hash): we can't auto-detect, so ask
    // for the transaction hash.
    res.json(
      VerifyCryptoPaymentResponse.parse({
        success: false,
        status: "not_found",
        message:
          "Enter your transaction hash once you've sent the payment to confirm it.",
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
    payerAddress: order.payerAddress ? getAddress(order.payerAddress) : null,
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

  // Manual replay guard (lower time bound). Manual orders are claimed by a unique
  // exact amount, but an expired order's amount can be recycled — so a transfer
  // that LANDED BEFORE this order existed must never settle it, regardless of how
  // the hash arrived (auto-detect OR a pasted hash). The auto-detect scan is
  // age-bounded for convenience, but the security check lives here so the pasted-
  // hash path can't bypass it. blockTimestamp === 0 means we couldn't read the
  // block; fall back to honoring (tx is mined + confirmed — the stronger signal).
  if (
    manual &&
    outcome.blockTimestamp > 0 &&
    outcome.blockTimestamp * 1000 < order.createdAt.getTime()
  ) {
    res.json(
      VerifyCryptoPaymentResponse.parse({
        success: false,
        status: "mismatch",
        message:
          "That transaction predates this order — please send a new payment for the exact amount shown.",
      }),
    );
    return;
  }

  // Granted. For a Lucky Break order we must SEED + run the draw before the
  // grant; gather entropy outside the write tx (it can be a large read) exactly
  // like the redeem path does. The draw itself happens inside the tx, once.
  const isLuckyBreak = order.passKind === LUCKY_BREAK_CODE_KIND;
  const entropy = isLuckyBreak ? await gatherShotEntropy() : [];

  // Issue the pass and settle the order in one transaction. The grant is
  // idempotent on the tx hash; for a Lucky Break order the roll is seeded by the
  // stable order id, so a re-verify reproduces the same outcome and we never
  // re-roll a settled payment. Lifetime's local subscription mutual-exclusion is
  // applied in-tx on both paths.
  let pass;
  let deduped;
  let luckyBreak: ReturnType<typeof toLuckyBreakReveal> | undefined;
  try {
    ({ pass, deduped, luckyBreak } = await db.transaction(async (tx) => {
      if (isLuckyBreak) {
        // Idempotency guard: if a prior verify already granted this payment,
        // return the existing pass + persisted roll WITHOUT drawing again.
        const [existing] = await tx
          .select()
          .from(passesTable)
          .where(
            and(
              eq(passesTable.sourceRef, txHash),
              eq(passesTable.source, "purchase"),
            ),
          )
          .limit(1);
        if (existing) {
          const [existingRoll] = await tx
            .select()
            .from(luckyBreakRollsTable)
            .where(eq(luckyBreakRollsTable.cryptoOrderId, order.id))
            .limit(1);
          await tx
            .update(cryptoOrdersTable)
            .set({
              status: "paid",
              txHash,
              passId: existing.id,
              updatedAt: new Date(),
            })
            .where(eq(cryptoOrdersTable.id, order.id));
          return {
            pass: existing,
            deduped: true,
            luckyBreak: existingRoll
              ? toLuckyBreakReveal(existingRoll)
              : undefined,
          };
        }

        const rollResult = computeLuckyBreakRoll(entropy, order.id);
        const issued = await issuePassTx(tx, {
          userId: user.id,
          kind: rollResult.outcome,
          source: "purchase",
          sourceRef: txHash,
          // Record what was actually paid (the Lucky Break price), not the
          // catalog price of the won tier.
          priceCents: order.priceCents,
        });
        if (issued.kind === "lifetime") {
          await stopRenewingActiveSubscriptionsTx(tx, user.id);
        }
        await tx.insert(luckyBreakRollsTable).values({
          id: newId(),
          userId: user.id,
          code: null,
          redemptionId: null,
          cryptoOrderId: order.id,
          seedHash: rollResult.seedHash,
          rolledValuePpm: Math.round(rollResult.value * 1_000_000),
          lifetimeProbabilityBps: Math.round(
            rollResult.lifetimeProbability * 10_000,
          ),
          outcome: rollResult.outcome,
          entropyShotCount: rollResult.entropyShotCount,
          windowDays: LUCKY_BREAK_WINDOW_DAYS,
          passId: issued.id,
        });
        await tx
          .update(cryptoOrdersTable)
          .set({
            status: "paid",
            txHash,
            passId: issued.id,
            updatedAt: new Date(),
          })
          .where(eq(cryptoOrdersTable.id, order.id));
        return {
          pass: issued,
          deduped: false,
          luckyBreak: {
            outcome: rollResult.outcome,
            lifetimeProbability: rollResult.lifetimeProbability,
            windowDays: LUCKY_BREAK_WINDOW_DAYS,
            seedHash: rollResult.seedHash,
            seededShotCount: rollResult.entropyShotCount,
          },
        };
      }

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
      return { pass: grant.pass, deduped: grant.deduped, luckyBreak: undefined };
    }));
  } catch (e) {
    // Unique-index race on the tx hash. Two outcomes are possible:
    //   (a) a *concurrent verify of THIS order* won the race — the order is now
    //       settled, our tx rolled back cleanly (no double roll/grant), and we
    //       should return the already-granted result (replaying the roll for a
    //       Lucky Break order so the reveal still plays); or
    //   (b) the same tx hash was used to settle a *different* order — a genuine
    //       mismatch.
    if ((e as { code?: string }).code === "23505") {
      const [settled] = await db
        .select()
        .from(cryptoOrdersTable)
        .where(eq(cryptoOrdersTable.id, order.id))
        .limit(1);
      if (settled?.status === "paid" && settled.passId) {
        const [grantedPass] = await db
          .select()
          .from(passesTable)
          .where(eq(passesTable.id, settled.passId))
          .limit(1);
        let luckyBreakReplay;
        if (settled.passKind === LUCKY_BREAK_CODE_KIND) {
          const [row] = await db
            .select()
            .from(luckyBreakRollsTable)
            .where(eq(luckyBreakRollsTable.cryptoOrderId, order.id))
            .limit(1);
          if (row) luckyBreakReplay = toLuckyBreakReveal(row);
        }
        res.json(
          VerifyCryptoPaymentResponse.parse({
            success: true,
            status: "granted",
            message: "This payment was already confirmed — you're all set.",
            pass: grantedPass ? passToSummary(grantedPass) : undefined,
            luckyBreak: luckyBreakReplay,
          }),
        );
        return;
      }
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
    {
      userId: user.id,
      kind: pass.kind,
      orderId: order.id,
      deduped,
      luckyBreak: luckyBreak
        ? { outcome: luckyBreak.outcome, seedHash: luckyBreak.seedHash }
        : undefined,
    },
    luckyBreak ? "Crypto Lucky Break verified" : "Crypto payment verified",
  );
  const message = luckyBreak
    ? luckyBreak.outcome === "lifetime"
      ? "JACKPOT — you rolled a Lifetime pass!"
      : "Nice break — you rolled a Monthly pass!"
    : `Paid — your ${pass.kind} pass is active!`;
  res.json(
    VerifyCryptoPaymentResponse.parse({
      success: true,
      status: "granted",
      message,
      pass: passToSummary(pass),
      luckyBreak,
    }),
  );
});

export default router;
