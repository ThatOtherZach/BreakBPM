import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  discountCodesTable,
  discountRedemptionsTable,
  luckyBreakRollsTable,
  freePassClaimsTable,
  type PassKind,
} from "@workspace/db";
import {
  RedeemDiscountCodeBody,
  RedeemDiscountCodeResponse,
  CreatePassCheckoutBody,
  CreatePassCheckoutResponse,
  VerifyPassCheckoutBody,
  VerifyPassCheckoutResponse,
  GenerateGiftCodeResponse,
  ListMyGiftCodesResponse,
  CreateAdminDiscountCodeBody,
  CreateAdminDiscountCodeResponse,
  ListAdminDiscountCodesResponse,
  ClaimFreePassResponse,
  GetFreePassClaimStatusResponse,
  GetMyInviteCodeResponse,
  AcceptInviteTrialBody,
  AcceptInviteTrialResponse,
} from "@workspace/api-zod";
import { getOrCreateUser } from "../lib/auth";
import { issuePassTx, grantPurchasedPassTx } from "../lib/passes";
import {
  recordSaleEventTx,
  valuationForCodeRedemption,
  PASS_PRODUCT_LABELS,
} from "../lib/saleEvents";
import { PASS_PRICES_CENTS } from "../lib/pricing";
import { stopRenewingActiveSubscriptionsTx } from "../lib/subscriptions";
import { getActivePasses } from "../lib/entitlement";
import {
  paymentProvider,
  stopRenewingStripeSubscriptions,
} from "../lib/paymentProvider";
import { newId } from "../lib/ids";
import {
  generateGiftCode,
  listMyGiftCodes,
  GiftCodeFailure,
} from "../lib/giftCodes";
import {
  createAdminDiscountCode,
  listAdminDiscountCodes,
  ADMIN_GRANTABLE_KINDS,
} from "../lib/adminCodes";
import {
  cardPaymentsEnabled,
  CARD_PAYMENTS_OFF_MESSAGE,
  isAdminEmail,
  luckyBreakLifetimeProbability,
  freePassMonthlyCap,
  inviteTrialLabel,
} from "../lib/config";
import {
  LUCKY_BREAK_CODE_KIND,
  LUCKY_BREAK_WINDOW_DAYS,
  computeLuckyBreakRoll,
  type EntropyShot,
  type LuckyBreakRollResult,
} from "../lib/luckyBreak";
import { gatherShotEntropy } from "../lib/luckyBreakEntropy";
import { getUsdToCadRate } from "../lib/fx";
import { redeemDiscountCodeForUserTx, RedeemFailure } from "../lib/redeemCore";
import {
  getOrCreateInviteCode,
  acceptInviteTx,
  InviteFailure,
} from "../lib/invites";
import {
  drawFreePassRewardTx,
  getFreePassClaimForUser,
  getRemainingStock,
  claimCodeLabel,
  currentPeriodKey,
  grantKindForReward,
  type FreePassRewardKind,
} from "../lib/freePassClaims";

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
 * Shape a Lucky Break roll into the API payload. Shared by the redeem and
 * claim routes so the disclosed fields stay in lockstep.
 */
function luckyBreakPayload(roll: LuckyBreakRollResult) {
  return {
    outcome: roll.outcome,
    lifetimeProbability: roll.lifetimeProbability,
    windowDays: LUCKY_BREAK_WINDOW_DAYS,
    seedHash: roll.seedHash,
    seededShotCount: roll.entropyShotCount,
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

  // Block redemption while any pass is already active. We check BEFORE
  // opening the transaction so a refused attempt doesn't burn the code's
  // single-redemption slot — the cap UPDATE below would otherwise increment
  // redemption_count and then roll back, but reading the row inside the tx
  // and then aborting is wasted work compared to this cheap pre-check.
  const existing = await getActivePasses(user.id);
  if (existing.length > 0) {
    res.json(
      RedeemDiscountCodeResponse.parse({
        success: false,
        message: "You already have an active pass.",
      }),
    );
    return;
  }

  // The redemption id is assigned up-front so it can be folded into the Lucky
  // Break seed (making each roll unique + unpredictable) AND used as the
  // discount_redemptions primary key, tying the roll record to the redemption.
  const redemptionId = newId();

  // Peek (non-locking) to learn whether this is a Lucky Break code so we can
  // gather the potentially-large shot entropy BEFORE opening the write
  // transaction. The authoritative validation still happens under FOR UPDATE
  // inside the tx; this read only decides whether to pay for entropy.
  const [peek] = await db
    .select({ kind: discountCodesTable.grantsPassKind })
    .from(discountCodesTable)
    .where(eq(discountCodesTable.code, code))
    .limit(1);
  const isLuckyBreak = peek?.kind === LUCKY_BREAK_CODE_KIND;
  const entropy: EntropyShot[] = isLuckyBreak ? await gatherShotEntropy() : [];

  // Freeze today's USD→CAD rate for the ledger BEFORE the tx (fx never throws).
  const fx = await getUsdToCadRate();

  // The whole validate → cap-claim → roll → issue → record sequence runs in
  // one transaction via the shared helper, which throws RedeemFailure for any
  // refusal path (so pg rolls back partial writes). /passes/claim reuses the
  // exact same helper after minting its single-use giveaway code.
  type Pass = { kind: string; startedAt: Date; durationSeconds: number | null };

  let pass: Pass;
  let roll: LuckyBreakRollResult | null;
  try {
    ({ pass, roll } = await db.transaction((tx) =>
      redeemDiscountCodeForUserTx(
        tx,
        { userId: user.id, code, redemptionId },
        { entropy, fx, lifetimeProbability: luckyBreakLifetimeProbability() },
      ),
    ));
  } catch (err) {
    if (err instanceof RedeemFailure) {
      // Not a discount / gift / Lucky Break code. If the code is simply unknown
      // ("Invalid code"), it may instead be a personal invite code — fall back
      // to the invite-trial path so both kinds of code redeem from this one box.
      // A real discount-code refusal (expired / fully redeemed / already used by
      // this caller) is surfaced as-is rather than masked by an invite attempt.
      if (err.reason === "Invalid code") {
        try {
          const { pass: trialPass, trialHours } = await db.transaction((tx) =>
            acceptInviteTx(
              tx,
              {
                invitedUserId: user.id,
                invitedUserCreatedAt: user.createdAt,
                code,
              },
              { fx, redemptionId: newId() },
            ),
          );
          req.log.info(
            { userId: user.id, code, trialHours },
            "Invite trial redeemed via code box",
          );
          res.json(
            RedeemDiscountCodeResponse.parse({
              success: true,
              message: `Granted a ${trialHours}-hour free trial!`,
              pass: passToSummary(trialPass),
            }),
          );
          return;
        } catch (inviteErr) {
          // A genuine invite code the caller can't use (self-invite, not a new
          // user, already redeemed) surfaces its own specific reason. An unknown
          // code (invalid_code) means it's neither a discount nor an invite code,
          // so we fall through to the original "Invalid code" message below.
          if (inviteErr instanceof InviteFailure) {
            if (inviteErr.reason !== "invalid_code") {
              res.json(
                RedeemDiscountCodeResponse.parse({
                  success: false,
                  message: INVITE_FAILURE_MESSAGES[inviteErr.reason],
                }),
              );
              return;
            }
          } else {
            req.log.error(
              { err: inviteErr, code, userId: user.id },
              "Invite fallback failed",
            );
            res.status(500).json({ error: "Redeem failed" });
            return;
          }
        }
      }
      res.json(RedeemDiscountCodeResponse.parse({ success: false, message: err.reason }));
      return;
    }
    req.log.error({ err, code, userId: user.id }, "Redeem failed");
    res.status(500).json({ error: "Redeem failed" });
    return;
  }

  req.log.info(
    {
      userId: user.id,
      code,
      passKind: pass.kind,
      luckyBreak: roll
        ? { outcome: roll.outcome, seedHash: roll.seedHash, shots: roll.entropyShotCount }
        : undefined,
    },
    roll ? "Lucky Break code redeemed" : "Discount code redeemed",
  );
  // Mirror the local mutual-exclusion to Stripe: a redeemed Lifetime must also
  // stop a real subscription from renewing (best-effort, outside the tx).
  if (pass.kind === "lifetime") {
    await stopRenewingStripeSubscriptions(user.id);
  }
  res.json(
    RedeemDiscountCodeResponse.parse({
      success: true,
      message: roll
        ? roll.outcome === "lifetime"
          ? "JACKPOT — you rolled a Lifetime pass!"
          : "Nice break — you rolled a Monthly pass!"
        : `Granted ${PASS_PRODUCT_LABELS[pass.kind as PassKind] ?? `${pass.kind} pass`}`,
      pass: passToSummary(pass),
      luckyBreak: roll ? luckyBreakPayload(roll) : undefined,
    }),
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Landing-page free-pass giveaway (#237)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Thrown inside the claim tx for an expected refusal (pool empty / racing
 * second claim) so pg rolls back the pool decrement + minted code. Distinct
 * from RedeemFailure (which the freshly-minted code should never trigger).
 */
class ClaimRefusal extends Error {
  constructor(public reason: "pool_empty" | "already_claimed") {
    super(reason);
  }
}

/**
 * Light in-memory per-IP throttle for the giveaway endpoints. Resets on process
 * restart — fine here: the claim mutation is auth-gated + one-per-account, and
 * the status read is a cheap pair of indexed lookups. This only caps abusive
 * hammering of the public surface.
 */
const FREE_PASS_RATE_WINDOW_MS = 60 * 1000;
const FREE_PASS_RATE_MAX = 60;
const freePassRateBuckets = new Map<string, { count: number; resetAt: number }>();

function freePassRateLimit(ip: string, bucket: string): boolean {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const b = freePassRateBuckets.get(key);
  if (!b || b.resetAt <= now) {
    freePassRateBuckets.set(key, { count: 1, resetAt: now + FREE_PASS_RATE_WINDOW_MS });
    return true;
  }
  if (b.count >= FREE_PASS_RATE_MAX) return false;
  b.count += 1;
  return true;
}

function claimSuccessMessage(
  rewardKind: FreePassRewardKind,
  roll: LuckyBreakRollResult | null,
): string {
  if (rewardKind === "lucky_break" && roll) {
    return roll.outcome === "lifetime"
      ? "JACKPOT — your free roll landed a Lifetime pass!"
      : "Nice break — your free roll landed a Monthly pass!";
  }
  return "You scored a free Day pass — enjoy!";
}

/**
 * Claim the one-per-account free pass. Mints a single-use giveaway code and
 * redeems it in ONE transaction (pool decrement, code, claim row, pass grant,
 * and ledger row commit together or not at all). The reward is drawn
 * server-side from the month's limited pools — never client-chosen. Three
 * authoritative guards stop a double grant: the active-pass pre-check, the
 * atomic pool decrement, and the UNIQUE(user_id) claim row.
 */
router.post("/passes/claim", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (!freePassRateLimit(ip, "claim")) {
    res.status(429).json({ error: "Too many requests — try again in a minute." });
    return;
  }

  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to claim your free pass" });
    return;
  }

  // Cheap pre-checks before the tx. The in-tx guards (atomic pool decrement +
  // UNIQUE user_id) are authoritative; these just avoid burning pool stock on
  // an obviously-ineligible caller and give a precise refusal reason.
  const existing = await getActivePasses(user.id);
  if (existing.length > 0) {
    res.json(
      ClaimFreePassResponse.parse({
        success: false,
        message: "You already have an active pass — no need to claim.",
        reason: "has_pass",
      }),
    );
    return;
  }
  const prior = await getFreePassClaimForUser(user.id);
  if (prior) {
    res.json(
      ClaimFreePassResponse.parse({
        success: false,
        message: "You've already claimed your free pass.",
        reason: "already_claimed",
      }),
    );
    return;
  }

  // Prefetch BEFORE the tx: the draw may land on Lucky Break (so entropy is
  // always gathered — the reward is unknown until the in-tx pool draw), and the
  // USD→CAD ledger rate is a network call frozen here.
  const entropy = await gatherShotEntropy();
  const fx = await getUsdToCadRate();
  const periodKey = currentPeriodKey();
  const cap = freePassMonthlyCap();
  const redemptionId = newId();

  let pass: { kind: string; startedAt: Date; durationSeconds: number | null };
  let roll: LuckyBreakRollResult | null;
  let rewardKind: FreePassRewardKind;
  try {
    ({ pass, roll, rewardKind } = await db.transaction(async (tx) => {
      // Atomic draw from the month's pools — null means everything is gone.
      const draw = await drawFreePassRewardTx(tx, periodKey, cap);
      if (!draw) throw new ClaimRefusal("pool_empty");

      const code = claimCodeLabel(draw.rewardKind, periodKey, draw.sequence);
      // Mint the single-use giveaway code in-tx, tagged issuerKind='claim' so
      // the ledger books it as a $0 comp even for a Lucky Break draw.
      await tx.insert(discountCodesTable).values({
        code,
        grantsPassKind: grantKindForReward(draw.rewardKind),
        maxRedemptions: 1,
        issuedByUserId: user.id,
        issuedAt: new Date(),
        issuerKind: "claim",
      });

      // One claim per account, ever. UNIQUE(user_id) is the race backstop: a
      // second concurrent claim fails here and rolls back the pool decrement.
      try {
        await tx.insert(freePassClaimsTable).values({
          id: newId(),
          userId: user.id,
          rewardKind: draw.rewardKind,
          code,
          periodKey,
          sequence: draw.sequence,
        });
      } catch (e) {
        const sqlState =
          (e as { code?: string }).code ??
          (e as { cause?: { code?: string } }).cause?.code;
        if (sqlState === "23505") throw new ClaimRefusal("already_claimed");
        throw e;
      }

      const result = await redeemDiscountCodeForUserTx(
        tx,
        { userId: user.id, code, redemptionId },
        { entropy, fx, lifetimeProbability: luckyBreakLifetimeProbability() },
      );
      return { pass: result.pass, roll: result.roll, rewardKind: draw.rewardKind };
    }));
  } catch (err) {
    if (err instanceof ClaimRefusal) {
      const message =
        err.reason === "pool_empty"
          ? "All free passes for this month are claimed — check back on the 1st!"
          : "You've already claimed your free pass.";
      res.json(ClaimFreePassResponse.parse({ success: false, message, reason: err.reason }));
      return;
    }
    // The freshly-minted code should always redeem cleanly; a RedeemFailure
    // here (or anything else) is unexpected — surface a transient error.
    req.log.error({ err, userId: user.id }, "Free pass claim failed");
    res.status(500).json({ error: "Claim failed" });
    return;
  }

  // Mirror the local Lifetime mutual-exclusion to Stripe (best-effort, post-tx).
  if (pass.kind === "lifetime") {
    await stopRenewingStripeSubscriptions(user.id);
  }

  req.log.info(
    {
      userId: user.id,
      rewardKind,
      passKind: pass.kind,
      luckyBreak: roll
        ? { outcome: roll.outcome, seedHash: roll.seedHash, shots: roll.entropyShotCount }
        : undefined,
    },
    "Free pass claimed",
  );

  res.json(
    ClaimFreePassResponse.parse({
      success: true,
      message: claimSuccessMessage(rewardKind, roll),
      rewardKind,
      pass: passToSummary(pass),
      luckyBreak: roll ? luckyBreakPayload(roll) : undefined,
    }),
  );
});

/**
 * Public giveaway status: remaining stock per pool + whether it's open. For a
 * signed-in caller, also whether they already claimed and are eligible now.
 */
router.get("/passes/claim/status", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (!freePassRateLimit(ip, "claim-status")) {
    res.status(429).json({ error: "Too many requests — try again in a minute." });
    return;
  }

  const cap = freePassMonthlyCap();
  const periodKey = currentPeriodKey();
  const remaining = await getRemainingStock(periodKey, cap);
  const open = remaining.lucky_break > 0 || remaining.day > 0;

  const user = await getOrCreateUser(req);
  let signedIn = false;
  let alreadyClaimed: boolean | undefined;
  let eligible: boolean | undefined;
  if (user) {
    signedIn = true;
    const [prior, activePasses] = await Promise.all([
      getFreePassClaimForUser(user.id),
      getActivePasses(user.id),
    ]);
    alreadyClaimed = Boolean(prior);
    eligible = open && !prior && activePasses.length === 0;
  }

  res.json(
    GetFreePassClaimStatusResponse.parse({
      open,
      periodKey,
      monthlyCap: cap,
      remainingLuckyBreak: remaining.lucky_break,
      remainingDay: remaining.day,
      signedIn,
      alreadyClaimed,
      eligible,
    }),
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Invite link → free trial (#308)
// ──────────────────────────────────────────────────────────────────────────

/** Maps each InviteFailure reason to a user-facing message. */
const INVITE_FAILURE_MESSAGES: Record<InviteFailure["reason"], string> = {
  invalid_code: "That invite link is no longer valid.",
  self_invite: "You can't use your own invite link.",
  not_new_user: "Invite trials are for brand-new players only.",
  has_pass: "You already have an active pass.",
  already_redeemed: "You've already used a free trial invite.",
};

/** The caller's stable personal invite code (generated lazily). */
router.get("/passes/invite", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to get your invite link" });
    return;
  }
  const code = await getOrCreateInviteCode(user.id);
  res.json(GetMyInviteCodeResponse.parse({ code, trialLabel: inviteTrialLabel() }));
});

/**
 * Redeem an invite link for a free trial pass. New-user-only, one-sided, and
 * granted at most once per new user (UNIQUE(invited_user_id) is the backstop).
 * The whole resolve → issue → record-redemption → ledger sequence runs in one
 * transaction via acceptInviteTx, which throws InviteFailure for any refusal
 * path so pg rolls back partial writes. Booked as a $0 comp.
 */
router.post("/passes/invite/accept", async (req, res): Promise<void> => {
  const parsed = AcceptInviteTrialBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to redeem an invite" });
    return;
  }

  const code = parsed.data.code.trim().toUpperCase();

  // Cheap pre-check before the tx so an already-paid caller doesn't burn work.
  // The in-tx new-user + UNIQUE guards are authoritative.
  const existing = await getActivePasses(user.id);
  if (existing.length > 0) {
    res.json(
      AcceptInviteTrialResponse.parse({
        success: false,
        message: INVITE_FAILURE_MESSAGES.has_pass,
        reason: "has_pass",
      }),
    );
    return;
  }

  // Freeze today's USD→CAD rate for the ledger BEFORE the tx (fx never throws).
  const fx = await getUsdToCadRate();
  const redemptionId = newId();

  let pass: { kind: string; startedAt: Date; durationSeconds: number | null };
  let trialHours: number;
  try {
    ({ pass, trialHours } = await db.transaction((tx) =>
      acceptInviteTx(
        tx,
        {
          invitedUserId: user.id,
          invitedUserCreatedAt: user.createdAt,
          code,
        },
        { fx, redemptionId },
      ),
    ));
  } catch (err) {
    if (err instanceof InviteFailure) {
      res.json(
        AcceptInviteTrialResponse.parse({
          success: false,
          message: INVITE_FAILURE_MESSAGES[err.reason],
          reason: err.reason,
        }),
      );
      return;
    }
    req.log.error({ err, code, userId: user.id }, "Invite accept failed");
    res.status(500).json({ error: "Invite redeem failed" });
    return;
  }

  req.log.info({ userId: user.id, code, trialHours }, "Invite trial granted");
  res.json(
    AcceptInviteTrialResponse.parse({
      success: true,
      message: `Welcome! Your ${trialHours}-hour free trial is active — enjoy.`,
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
  if (!cardPaymentsEnabled()) {
    res.json(
      CreatePassCheckoutResponse.parse({
        success: false,
        message: CARD_PAYMENTS_OFF_MESSAGE,
      }),
    );
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
  if (!cardPaymentsEnabled()) {
    res.json(
      VerifyPassCheckoutResponse.parse({
        success: false,
        message: CARD_PAYMENTS_OFF_MESSAGE,
      }),
    );
    return;
  }
  const verify = await paymentProvider.verifyAndGrant(
    parsed.data.opaqueToken,
    user.id,
  );
  if (!verify.success || !verify.kind) {
    res.json(VerifyPassCheckoutResponse.parse({ success: false, message: verify.message }));
    return;
  }
  // Idempotent grant — the webhook may have already granted this same
  // purchase. Dedup is keyed on the provider payment reference. Lifetime's
  // local subscription mutual-exclusion is applied inside the helper.
  const sourceRef = verify.providerRef ?? parsed.data.opaqueToken;
  // Freeze today's USD→CAD rate for the ledger BEFORE the tx (fx never throws).
  const fx = await getUsdToCadRate();
  const { pass, deduped } = await db.transaction(async (tx) => {
    const grant = await grantPurchasedPassTx(tx, {
      userId: user.id,
      kind: verify.kind!,
      sourceRef,
    });
    // Sales ledger: record the paid Stripe purchase once, in the same tx. The
    // webhook records the same row keyed on the same provider_ref (payment
    // intent), so whichever path wins the grant writes the sale and the other
    // is a no-op (ON CONFLICT) — exactly one ledger row per purchase.
    if (!grant.deduped) {
      await recordSaleEventTx(tx, {
        userId: user.id,
        eventType: "stripe_purchase",
        paymentMethod: "stripe",
        grossCents: PASS_PRICES_CENTS[verify.kind!],
        isComp: false,
        productLabel: PASS_PRODUCT_LABELS[verify.kind!],
        fx,
        providerRef: sourceRef,
      });
    }
    return grant;
  });
  req.log.info(
    { userId: user.id, kind: pass.kind, deduped },
    "Pass purchase verified",
  );
  // First-time Lifetime grant also stops the real Stripe subscription from
  // renewing (best-effort, outside the tx). Skipped on dedup — the webhook or
  // an earlier verify already handled it.
  if (pass.kind === "lifetime" && !deduped) {
    await stopRenewingStripeSubscriptions(user.id);
  }
  res.json(
    VerifyPassCheckoutResponse.parse({
      success: true,
      message: verify.message,
      pass: passToSummary(pass),
    }),
  );
});

/**
 * List the caller's recently-generated Day-Pass gift codes + cooldown
 * state. Returns `eligible: false` for users without a qualifying pass so
 * the client can hide the gift section without an extra entitlement call.
 */
router.get("/passes/discount-codes", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view your gift codes" });
    return;
  }
  const result = await listMyGiftCodes(user.id, isAdminEmail(user.email));
  res.json(
    ListMyGiftCodesResponse.parse({
      eligible: result.eligible,
      codes: result.codes,
      cooldownActive: result.cooldownActive,
      nextAvailableAt: result.nextAvailableAt,
    }),
  );
});

/**
 * Mint a new single-use 24-hour Day-Pass gift code for the caller. The
 * library raises GiftCodeFailure with a reason we translate to a
 * `{ success: false, message }` body; unexpected failures bubble up as
 * 500s so they surface in logs.
 */
router.post("/passes/discount-codes", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to gift a Day Pass" });
    return;
  }
  try {
    const result = await generateGiftCode(user.id, isAdminEmail(user.email));
    // Do not log the raw code — anyone with log access could redeem it.
    // Log issuer + expiry instead so we can still trace gifting activity.
    req.log.info(
      { userId: user.id, expiresAt: result.code.expiresAt },
      "Gift Day-Pass code generated",
    );
    res.json(
      GenerateGiftCodeResponse.parse({
        success: true,
        message: "Gift code generated.",
        code: result.code,
        nextAvailableAt: result.nextAvailableAt,
      }),
    );
  } catch (err) {
    if (err instanceof GiftCodeFailure) {
      // For cooldown rejections we still need a nextAvailableAt so the
      // client can refresh its disabled state without a second round-trip.
      const fallbackNext =
        err.reason === "cooldown_active" && err.cooldownRemainingMs !== undefined
          ? new Date(Date.now() + err.cooldownRemainingMs)
          : new Date();
      res.json(
        GenerateGiftCodeResponse.parse({
          success: false,
          message: err.message,
          nextAvailableAt: fallbackNext,
        }),
      );
      return;
    }
    req.log.error({ err, userId: user.id }, "Gift code generation failed");
    res.status(500).json({ error: "Gift code generation failed" });
  }
});

/**
 * List the comp codes the calling admin has minted. 403s for non-admins so
 * the admin generator never leaks to ordinary accounts. The admin allowlist
 * itself is never returned — only the caller's own codes.
 */
router.get("/passes/admin/codes", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage admin codes" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }
  const codes = await listAdminDiscountCodes(user.id);
  res.json(ListAdminDiscountCodesResponse.parse({ codes }));
});

/**
 * Mint a new admin comp code granting the chosen tier with an optional
 * redemption cap. 403s for non-admins.
 */
router.post("/passes/admin/codes", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to mint admin codes" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }
  const parsed = CreateAdminDiscountCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const kind = parsed.data.kind;
  if (!ADMIN_GRANTABLE_KINDS.includes(kind)) {
    res.status(400).json({ error: "Unsupported pass tier" });
    return;
  }
  const maxRedemptions = parsed.data.maxRedemptions ?? null;
  if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) {
    res.status(400).json({ error: "maxRedemptions must be a positive integer or omitted" });
    return;
  }

  const includeArtwork = parsed.data.includeArtwork ?? true;
  const code = await createAdminDiscountCode({
    issuedByUserId: user.id,
    kind,
    maxRedemptions,
    includeArtwork,
  });
  // Do not log the raw code — anyone with log access could redeem it.
  req.log.info(
    { userId: user.id, kind, maxRedemptions, includeArtwork },
    "Admin comp code generated",
  );
  res.json(CreateAdminDiscountCodeResponse.parse({ code }));
});

export default router;
