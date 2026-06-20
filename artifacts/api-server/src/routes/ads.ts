import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import {
  db,
  adsTable,
  cryptoOrdersTable,
  gamesTable,
  usersTable,
  type CryptoAsset,
} from "@workspace/db";
import {
  ListAdsResponse,
  ListAdminAdsQueryParams,
  ListAdminAdsResponse,
  CreateAdBody,
  CreateAdResponse,
  DeleteAdParams,
  DeleteAdResponse,
  GetAdPricingResponse,
  CreateAdQuoteBody,
  CreateAdQuoteResponse,
  ListMyAdsResponse,
  ApproveAdParams,
  ApproveAdResponse,
  DenyAdParams,
  DenyAdResponse,
} from "@workspace/api-zod";
import { getOrCreateUser } from "../lib/auth";
import {
  isAdminEmail,
  adBaseDailyCents,
  adMinDailyCents,
  adMaxDays,
  cryptoPaymentsEnabled,
  CRYPTO_PAYMENTS_OFF_MESSAGE,
} from "../lib/config";
import { newId } from "../lib/ids";
import { sanitizeAdCopy } from "../lib/adContent";
import { computeAdQuote } from "../lib/pricing";
import {
  cryptoConfigured,
  getNetworkConfig,
  getReceivingAddress,
  getQuoteTtlSeconds,
  readEthUsd,
  usdcAtomicAmount,
  ethWeiAmount,
  manualAmountTail,
} from "../lib/cryptoChain";
import { formatUnits } from "viem";

const router: IRouter = Router();

type AdRow = typeof adsTable.$inferSelect;

/** Shape a DB row into the public Ad contract (drops audit-only columns). */
function toAdResponse(row: AdRow & { sponsor?: string | null }) {
  return {
    id: row.id,
    headline: row.headline,
    tagline: row.tagline,
    sponsor: row.sponsor ?? null,
  };
}

/**
 * Count ads that are currently LIVE in the HUD rotation: approved AND either
 * never-expiring (house ads) or not yet past their expiry window. This is the
 * `activeAdsCount` half of the demand multiplier.
 */
async function countActiveAds(): Promise<number> {
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(adsTable)
    .where(
      and(
        eq(adsTable.status, "approved"),
        or(isNull(adsTable.expiryAt), gt(adsTable.expiryAt, new Date())),
      ),
    );
  return n;
}

/** Count games completed in the last 24h — the `gamesLast24h` multiplier half. */
async function countGamesLast24h(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(gamesTable)
    .where(gt(gamesTable.endedAt, since));
  return n;
}

/**
 * GET /ads — public, ordered list of every LIVE text ad (oldest-first) for the
 * in-game HUD rotation. Live = approved AND (no expiry OR not yet expired), so
 * pending/denied/expired ads never reach the client. Each ad carries its buyer
 * screen name as `sponsor` (null for house ads) for the "Sponsored" credit. The
 * client decides who sees an ad (non-paying users only) and rotates client-side.
 */
router.get("/ads", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: adsTable.id,
      headline: adsTable.headline,
      tagline: adsTable.tagline,
      sponsor: usersTable.screenName,
    })
    .from(adsTable)
    .leftJoin(usersTable, eq(adsTable.ownerUserId, usersTable.id))
    .where(
      and(
        eq(adsTable.status, "approved"),
        or(isNull(adsTable.expiryAt), gt(adsTable.expiryAt, new Date())),
      ),
    )
    .orderBy(asc(adsTable.createdAt));
  res.json(
    ListAdsResponse.parse({
      ads: rows.map((r) => ({
        id: r.id,
        headline: r.headline,
        tagline: r.tagline,
        sponsor: r.sponsor ?? null,
      })),
    }),
  );
});

/**
 * GET /ads/pricing — current dynamic ad pricing for the buyer UI. Returns the
 * live per-day rate (base × demand multiplier, floored), the max run length, and
 * the active-ad count that drives the multiplier. The client multiplies
 * effectiveDailyCents by the chosen days; /ads/quote re-freezes the same number.
 */
router.get("/ads/pricing", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to buy an ad" });
    return;
  }

  const [activeAdsCount, gamesLast24h] = await Promise.all([
    countActiveAds(),
    countGamesLast24h(),
  ]);
  const baseDailyCents = adBaseDailyCents();
  const minDailyCents = adMinDailyCents();
  const { effectiveDailyCents } = computeAdQuote({
    days: 1,
    activeAdsCount,
    gamesLast24h,
    baseDailyCents,
    minDailyCents,
  });

  res.json(
    GetAdPricingResponse.parse({
      cryptoEnabled: cryptoConfigured(cryptoPaymentsEnabled()),
      baseDailyCents,
      minDailyCents,
      effectiveDailyCents,
      maxDays: adMaxDays(),
      activeAdsCount,
    }),
  );
});

/**
 * POST /ads/quote — quote a user-bought HUD ad for on-chain payment. Validates +
 * sanitizes the copy, re-freezes the current per-day rate × days into a total,
 * and creates a MANUAL crypto order (purpose='ad') payable by sending the unique
 * exact amount to our receiving address from any wallet. The ad copy + run
 * length are snapshotted on the order; the ad row itself is created (status
 * pending_review) only once /crypto/verify confirms payment. Mirrors the manual
 * reservation loop in /crypto/quote so concurrent quotes never share an amount.
 */
router.post("/ads/quote", async (req, res): Promise<void> => {
  const parsed = CreateAdQuoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to buy an ad" });
    return;
  }
  if (!cryptoConfigured(cryptoPaymentsEnabled())) {
    res.json(
      CreateAdQuoteResponse.parse({
        success: false,
        message: CRYPTO_PAYMENTS_OFF_MESSAGE,
      }),
    );
    return;
  }

  const copy = sanitizeAdCopy(parsed.data.headline, parsed.data.tagline);
  if (!copy.ok) {
    res.json(CreateAdQuoteResponse.parse({ success: false, message: copy.message }));
    return;
  }

  const days = parsed.data.days;
  if (days < 1 || days > adMaxDays()) {
    res.json(
      CreateAdQuoteResponse.parse({
        success: false,
        message: `Pick between 1 and ${adMaxDays()} days.`,
      }),
    );
    return;
  }

  const [activeAdsCount, gamesLast24h] = await Promise.all([
    countActiveAds(),
    countGamesLast24h(),
  ]);
  const quote = computeAdQuote({
    days,
    activeAdsCount,
    gamesLast24h,
    baseDailyCents: adBaseDailyCents(),
    minDailyCents: adMinDailyCents(),
  });

  const cfg = getNetworkConfig();
  const receivingAddress = getReceivingAddress();
  if (!receivingAddress) {
    res.json(
      CreateAdQuoteResponse.parse({
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
      baseAmount = usdcAtomicAmount(quote.totalCents, decimals);
      tokenAddress = cfg.usdcAddress;
      symbol = "USDC";
    } else {
      const eth = await readEthUsd();
      decimals = 18;
      baseAmount = ethWeiAmount(quote.totalCents, eth);
      tokenAddress = null;
      ethUsdRaw = eth.raw.toString();
      symbol = "ETH";
    }
  } catch (err) {
    req.log.error({ err }, "Ad quote price read failed");
    res.json(
      CreateAdQuoteResponse.parse({
        success: false,
        message: "Couldn't fetch a live price just now — try again in a moment.",
      }),
    );
    return;
  }

  const expiresAt = new Date(Date.now() + getQuoteTtlSeconds() * 1000);

  // Ad orders are always MANUAL (no bound payer): pay the unique exact amount to
  // our address from any wallet. Reserve a unique amount atomically via the
  // partial unique index (INSERT ON CONFLICT DO NOTHING + retry with a fresh
  // tail), exactly like /crypto/quote.
  const id = newId();
  let expectedAmount = baseAmount;
  let reserved = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = baseAmount + manualAmountTail(asset);
    const inserted = await db
      .insert(cryptoOrdersTable)
      .values({
        id,
        userId: user.id,
        purpose: "ad",
        passKind: null,
        asset,
        network: cfg.network,
        chainId: cfg.chainId,
        receivingAddress,
        payerAddress: null,
        tokenAddress,
        expectedAmount: candidate.toString(),
        priceCents: quote.totalCents,
        ethUsdRaw,
        status: "pending",
        adHeadline: copy.headline,
        adTagline: copy.tagline,
        adDays: days,
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
      CreateAdQuoteResponse.parse({
        success: false,
        message: "Couldn't reserve a payment amount just now — please try again.",
      }),
    );
    return;
  }

  res.json(
    CreateAdQuoteResponse.parse({
      success: true,
      message: "Quote ready.",
      order: {
        id,
        manual: true,
        asset,
        network: cfg.network,
        chainId: cfg.chainId,
        receivingAddress,
        tokenAddress,
        expectedAmount: expectedAmount.toString(),
        decimals,
        displayAmount: `${formatUnits(expectedAmount, decimals)} ${symbol}`,
        priceCents: quote.totalCents,
        days,
        expiresAt,
      },
    }),
  );
});

/**
 * GET /ads/mine — the caller's own bought ads (newest-first) with moderation
 * status + live window, for the buyer's "my ads" list. Signed-in only.
 */
router.get("/ads/mine", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to see your ads" });
    return;
  }

  const rows = await db
    .select()
    .from(adsTable)
    .where(eq(adsTable.ownerUserId, user.id))
    .orderBy(desc(adsTable.createdAt));

  res.json(
    ListMyAdsResponse.parse({
      ads: rows.map((r) => ({
        id: r.id,
        headline: r.headline,
        tagline: r.tagline,
        status: r.status,
        days: r.days,
        priceCents: r.priceCents,
        startAt: r.startAt,
        expiryAt: r.expiryAt,
        createdAt: r.createdAt,
      })),
    }),
  );
});

/**
 * GET /admin/ads — paginated list of text ads for the admin moderation panel.
 * Ordered pending-first (the review queue), then newest-first, and enriched with
 * the buyer identity + purchase window. Admin-only (403 for everyone else).
 */
router.get("/admin/ads", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage ads" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const parsed = ListAdminAdsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page, limit } = parsed.data;

  const [{ n: total } = { n: 0 }] = await db
    .select({ n: count() })
    .from(adsTable);

  const rows = await db
    .select({
      id: adsTable.id,
      headline: adsTable.headline,
      tagline: adsTable.tagline,
      status: adsTable.status,
      ownerUserId: adsTable.ownerUserId,
      days: adsTable.days,
      priceCents: adsTable.priceCents,
      startAt: adsTable.startAt,
      expiryAt: adsTable.expiryAt,
      createdAt: adsTable.createdAt,
      ownerEmail: usersTable.email,
      ownerScreenName: usersTable.screenName,
    })
    .from(adsTable)
    .leftJoin(usersTable, eq(adsTable.ownerUserId, usersTable.id))
    // Pending ads float to the top (the review queue), then newest-first.
    .orderBy(
      sql`CASE WHEN ${adsTable.status} = 'pending_review' THEN 0 ELSE 1 END`,
      desc(adsTable.createdAt),
    )
    .limit(limit)
    .offset((page - 1) * limit);

  res.json(
    ListAdminAdsResponse.parse({
      ads: rows.map((r) => ({
        id: r.id,
        headline: r.headline,
        tagline: r.tagline,
        status: r.status,
        isHouse: r.ownerUserId === null,
        ownerEmail: r.ownerUserId ? r.ownerEmail ?? null : null,
        ownerScreenName: r.ownerUserId ? r.ownerScreenName ?? null : null,
        days: r.days,
        priceCents: r.priceCents,
        startAt: r.startAt,
        expiryAt: r.expiryAt,
        createdAt: r.createdAt,
      })),
      page,
      limit,
      total,
    }),
  );
});

/**
 * POST /admin/ads — add a HOUSE text ad (headline + tagline). Admin-only. House
 * ads default to status 'approved' with no owner/expiry, so they show
 * immediately and never expire. Inputs are sanitized + refused if blank.
 */
router.post("/admin/ads", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage ads" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const parsed = CreateAdBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const copy = sanitizeAdCopy(parsed.data.headline, parsed.data.tagline);
  if (!copy.ok) {
    res.json(CreateAdResponse.parse({ success: false, reason: copy.message }));
    return;
  }

  const [row] = await db
    .insert(adsTable)
    .values({
      id: newId(),
      headline: copy.headline,
      tagline: copy.tagline,
      createdByUserId: user.id,
      status: "approved",
    })
    .returning();

  req.log.info({ userId: user.id, adId: row.id }, "House ad created");
  res.json(CreateAdResponse.parse({ success: true, ad: toAdResponse(row) }));
});

/**
 * POST /admin/ads/:id/approve — approve a pending user-bought ad: set
 * status=approved and open its live window (startAt=now, expiryAt=now+days) so
 * it enters the HUD rotation for exactly the purchased run length. Admin-only.
 * 200 + success:false/reason on a missing or non-pending ad.
 */
router.post("/admin/ads/:id/approve", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage ads" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const params = ApproveAdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [ad] = await db
    .select()
    .from(adsTable)
    .where(eq(adsTable.id, params.data.id))
    .limit(1);
  if (!ad) {
    res.json(ApproveAdResponse.parse({ success: false, reason: "not_found" }));
    return;
  }
  if (ad.status !== "pending_review") {
    res.json(ApproveAdResponse.parse({ success: false, reason: "not_pending" }));
    return;
  }

  const now = new Date();
  const days = ad.days ?? 1;
  const expiryAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const [row] = await db
    .update(adsTable)
    .set({ status: "approved", startAt: now, expiryAt })
    .where(eq(adsTable.id, ad.id))
    .returning();

  req.log.info({ userId: user.id, adId: ad.id }, "Ad approved");
  res.json(ApproveAdResponse.parse({ success: true, ad: toAdResponse(row) }));
});

/**
 * POST /admin/ads/:id/deny — deny a pending user-bought ad: set status=denied so
 * it never runs. The payment is intentionally kept (no auto-refund). Admin-only.
 * 200 + success:false/reason on a missing or non-pending ad.
 */
router.post("/admin/ads/:id/deny", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage ads" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const params = DenyAdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [ad] = await db
    .select()
    .from(adsTable)
    .where(eq(adsTable.id, params.data.id))
    .limit(1);
  if (!ad) {
    res.json(DenyAdResponse.parse({ success: false, reason: "not_found" }));
    return;
  }
  if (ad.status !== "pending_review") {
    res.json(DenyAdResponse.parse({ success: false, reason: "not_pending" }));
    return;
  }

  const [row] = await db
    .update(adsTable)
    .set({ status: "denied" })
    .where(eq(adsTable.id, ad.id))
    .returning();

  req.log.info({ userId: user.id, adId: ad.id }, "Ad denied");
  res.json(DenyAdResponse.parse({ success: true, ad: toAdResponse(row) }));
});

/**
 * DELETE /admin/ads/:id — remove a text ad permanently. Admin-only. 200 +
 * `success:false, reason:"not_found"` when the id doesn't exist.
 */
router.delete("/admin/ads/:id", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage ads" });
    return;
  }
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }

  const params = DeleteAdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .delete(adsTable)
    .where(eq(adsTable.id, params.data.id))
    .returning();

  if (!row) {
    res.json(DeleteAdResponse.parse({ success: false, reason: "not_found" }));
    return;
  }

  req.log.info({ userId: user.id, adId: row.id }, "Ad deleted");
  res.json(DeleteAdResponse.parse({ success: true, ad: toAdResponse(row) }));
});

export default router;
