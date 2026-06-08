import { randomBytes } from "crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  passesTable,
  subscriptionsTable,
  discountCodesTable,
  discountRedemptionsTable,
  luckyBreakRollsTable,
  cryptoOrdersTable,
  saleEventsTable,
  gamesTable,
  gameParticipantsTable,
  PASS_DURATIONS_SECONDS,
  type User,
  type Pass,
  type DiscountCode,
  type DiscountRedemption,
  type LuckyBreakRoll,
  type CryptoOrder,
  type CryptoAsset,
  type SaleEvent,
  type Subscription,
  type Game,
  type GameParticipant,
  type PassKind,
  type SubscriptionInterval,
  type SubscriptionStatus,
} from "@workspace/db";

/**
 * Test factories for the api-server integration tests. Everything created
 * here is tracked so `cleanup()` (called from an afterEach) can delete it,
 * keeping the shared dev database tidy even when a test fails mid-way.
 */

const createdUserIds: string[] = [];
const createdCodes: string[] = [];
const createdGameIds: string[] = [];

function rid(): string {
  return randomBytes(16).toString("hex");
}

/** Safe 5-char share-code alphabet (mirrors lib/shareCode.ts). */
const SHARE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** A normalized (uppercase, alphabet-only) 5-char share code. */
export function uniqueShareCode(): string {
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += SHARE_ALPHABET[Math.floor(Math.random() * SHARE_ALPHABET.length)];
  }
  return out;
}

/** A code guaranteed not to collide with seed/admin codes. */
export function uniqueCode(prefix = "TEST"): string {
  return `${prefix}${rid().slice(0, 12).toUpperCase()}`;
}

export async function createUser(
  opts: { email?: string | null } = {},
): Promise<User> {
  const [user] = await db
    .insert(usersTable)
    .values({
      id: rid(),
      authProvider: "test",
      authSubject: `test_${rid()}`,
      screenName: `Tester_${rid().slice(0, 6)}`,
      email: opts.email ?? null,
      onboardingCompletedAt: new Date(),
    })
    .returning();
  createdUserIds.push(user.id);
  return user;
}

export async function seedPass(
  userId: string,
  kind: PassKind,
  opts: { startedAt?: Date; durationSeconds?: number | null } = {},
): Promise<Pass> {
  const startedAt = opts.startedAt ?? new Date();
  const durationSeconds =
    opts.durationSeconds !== undefined
      ? opts.durationSeconds
      : PASS_DURATIONS_SECONDS[kind];
  const [row] = await db
    .insert(passesTable)
    .values({
      id: rid(),
      userId,
      kind,
      startedAt,
      durationSeconds,
      source: "grant",
      sourceRef: null,
      priceCents: 0,
    })
    .returning();
  return row;
}

export async function seedSubscription(
  userId: string,
  opts: {
    status?: SubscriptionStatus;
    interval?: SubscriptionInterval;
    startedAt?: Date;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd?: boolean;
  } = {},
): Promise<Subscription> {
  const startedAt = opts.startedAt ?? new Date();
  const [row] = await db
    .insert(subscriptionsTable)
    .values({
      id: rid(),
      userId,
      status: opts.status ?? "active",
      interval: opts.interval ?? "month",
      priceCents: 0,
      startedAt,
      currentPeriodEnd:
        opts.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? false,
      source: "grant",
    })
    .returning();
  return row;
}

export async function seedDiscountCode(
  code: string,
  grantsPassKind: PassKind,
  opts: {
    maxRedemptions?: number | null;
    expiresAt?: Date | null;
    issuedByUserId?: string | null;
    issuerKind?: string | null;
    issuedAt?: Date | null;
  } = {},
): Promise<void> {
  await db.insert(discountCodesTable).values({
    code,
    grantsPassKind,
    maxRedemptions: opts.maxRedemptions ?? null,
    expiresAt: opts.expiresAt ?? null,
    issuedByUserId: opts.issuedByUserId ?? null,
    issuerKind: opts.issuerKind ?? null,
    issuedAt: opts.issuedAt ?? null,
  });
  createdCodes.push(code);
}

/**
 * Seed a Lucky Break discount code (grantsPassKind = 'lucky_break'). These
 * codes run the seeded draw on redeem rather than granting a fixed pass tier.
 */
export async function seedLuckyBreakDiscountCode(
  code: string,
  opts: { maxRedemptions?: number | null; expiresAt?: Date | null } = {},
): Promise<void> {
  await db.insert(discountCodesTable).values({
    code,
    grantsPassKind: "lucky_break",
    maxRedemptions: opts.maxRedemptions ?? null,
    expiresAt: opts.expiresAt ?? null,
    issuedByUserId: null,
    issuerKind: null,
    issuedAt: null,
  });
  createdCodes.push(code);
}

/**
 * Seed a discount code tagged `issuerKind = 'admin'` (as created by the
 * admin code-minting route). Admin codes never expire and carry a chosen
 * redemption cap. They share `issuedByUserId` with the issuing admin's
 * gift codes but are kept isolated by `giftScope()` in the gift flow.
 */
export async function seedAdminDiscountCode(
  code: string,
  grantsPassKind: PassKind,
  issuedByUserId: string,
  opts: { maxRedemptions?: number | null; issuedAt?: Date } = {},
): Promise<void> {
  await db.insert(discountCodesTable).values({
    code,
    grantsPassKind,
    maxRedemptions: opts.maxRedemptions ?? null,
    expiresAt: null,
    issuedByUserId,
    issuedAt: opts.issuedAt ?? new Date(),
    issuerKind: "admin",
  });
  createdCodes.push(code);
}

/**
 * Insert an in-progress game row plus its host participant (slot 0). The
 * host is `hostUserId`. Returns the game row. The game and its participants
 * are tracked for cleanup.
 */
export async function seedGame(
  hostUserId: string,
  opts: {
    gameType?: string;
    maxPlayers?: number;
    shareCode?: string;
    hostName?: string;
    shotLog?: Array<Record<string, unknown>>;
    endedAt?: Date | null;
    startedAt?: Date;
  } = {},
): Promise<Game> {
  const id = rid();
  const shareCode = opts.shareCode ?? uniqueShareCode();
  const startedAt = opts.startedAt ?? new Date();
  const gameType = opts.gameType ?? "8ball";
  const maxPlayers = opts.maxPlayers ?? 2;
  const [row] = await db
    .insert(gamesTable)
    .values({
      id,
      userId: hostUserId,
      gameType,
      maxPlayers,
      shareCode,
      gameState: {
        gameType,
        startedAt: startedAt.toISOString(),
        shareCode,
        ...(opts.shotLog ? { shotLog: opts.shotLog } : {}),
      },
      startedAt,
      lastActivityAt: startedAt,
      endedAt: opts.endedAt ?? null,
      outcome: opts.endedAt ? "completed" : null,
    })
    .returning();
  createdGameIds.push(id);
  await db.insert(gameParticipantsTable).values({
    gameId: id,
    slotIndex: 0,
    userId: hostUserId,
    displayName: opts.hostName ?? "Host",
    isHost: true,
    joinedAt: startedAt,
    statsStartAt: startedAt,
  });
  return row;
}

/** Insert a (non-host) participant row into an existing game. */
export async function seedParticipant(
  gameId: string,
  slotIndex: number,
  opts: {
    userId?: string | null;
    displayName?: string;
    guestToken?: string | null;
    leftAt?: Date | null;
  } = {},
): Promise<GameParticipant> {
  const now = new Date();
  const [row] = await db
    .insert(gameParticipantsTable)
    .values({
      gameId,
      slotIndex,
      userId: opts.userId ?? null,
      displayName: opts.displayName ?? `Player ${slotIndex + 1}`,
      isHost: false,
      joinedAt: now,
      statsStartAt: now,
      leftAt: opts.leftAt ?? null,
      guestToken: opts.guestToken ?? null,
    })
    .returning();
  return row;
}

/**
 * Seed a crypto checkout order (as produced by POST /crypto/quote). Defaults to
 * a manual (payer-less) Lucky Break USDC order in the `pending` state so the
 * verify route can settle it. Addresses are throw-away valid hex so the route's
 * `viem.getAddress` calls succeed. Cascades on user delete (no extra cleanup).
 */
export async function seedCryptoOrder(
  userId: string,
  opts: {
    passKind?: string;
    asset?: CryptoAsset;
    status?: string;
    payerAddress?: string | null;
    expectedAmount?: string;
    chainId?: number;
    network?: string;
    priceCents?: number;
    txHash?: string | null;
    passId?: string | null;
    createdAt?: Date;
    expiresAt?: Date;
  } = {},
): Promise<CryptoOrder> {
  const asset = opts.asset ?? "usdc";
  const values: typeof cryptoOrdersTable.$inferInsert = {
    id: rid(),
    userId,
    passKind: opts.passKind ?? "lucky_break",
    asset,
    network: opts.network ?? "base",
    chainId: opts.chainId ?? 8453,
    receivingAddress: `0x${"a".repeat(40)}`,
    payerAddress: opts.payerAddress ?? null,
    tokenAddress: asset === "eth" ? null : `0x${"b".repeat(40)}`,
    expectedAmount: opts.expectedAmount ?? "1000000",
    priceCents: opts.priceCents ?? 499,
    ethUsdRaw: null,
    status: opts.status ?? "pending",
    txHash: opts.txHash ?? null,
    passId: opts.passId ?? null,
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000),
  };
  if (opts.createdAt) values.createdAt = opts.createdAt;
  const [row] = await db.insert(cryptoOrdersTable).values(values).returning();
  return row;
}

export async function getCryptoOrder(
  id: string,
): Promise<CryptoOrder | undefined> {
  const rows = await db
    .select()
    .from(cryptoOrdersTable)
    .where(eq(cryptoOrdersTable.id, id))
    .limit(1);
  return rows[0];
}

export async function getGame(gameId: string): Promise<Game | undefined> {
  const rows = await db.select().from(gamesTable).where(eq(gamesTable.id, gameId)).limit(1);
  return rows[0];
}

export async function getParticipants(gameId: string): Promise<GameParticipant[]> {
  return db
    .select()
    .from(gameParticipantsTable)
    .where(eq(gameParticipantsTable.gameId, gameId));
}

export async function getSubscriptions(userId: string): Promise<Subscription[]> {
  return db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId));
}

export async function getPasses(userId: string): Promise<Pass[]> {
  return db.select().from(passesTable).where(eq(passesTable.userId, userId));
}

export async function getDiscountCode(
  code: string,
): Promise<DiscountCode | undefined> {
  const rows = await db
    .select()
    .from(discountCodesTable)
    .where(eq(discountCodesTable.code, code))
    .limit(1);
  return rows[0];
}

export async function getRedemptions(userId: string): Promise<DiscountRedemption[]> {
  return db
    .select()
    .from(discountRedemptionsTable)
    .where(eq(discountRedemptionsTable.userId, userId));
}

export async function getLuckyBreakRolls(userId: string): Promise<LuckyBreakRoll[]> {
  return db
    .select()
    .from(luckyBreakRollsTable)
    .where(eq(luckyBreakRollsTable.userId, userId));
}

export async function getSaleEvents(userId: string): Promise<SaleEvent[]> {
  return db
    .select()
    .from(saleEventsTable)
    .where(eq(saleEventsTable.userId, userId));
}

/**
 * Seed a sale_events row directly (bypassing the recording lib) so endpoint
 * tests can control the date range, totals, and comp flag. Defaults to a $4.99
 * tax-inclusive crypto sale (gst 22, pst 31, net 446 → sums to 499).
 */
export async function seedSaleEvent(
  userId: string,
  opts: {
    eventType?: string;
    paymentMethod?: string;
    productLabel?: string;
    isComp?: boolean;
    grossCents?: number;
    gstCents?: number;
    pstCents?: number;
    netCents?: number;
    gstRateBps?: number;
    pstRateBps?: number;
    sourceGrossCents?: number;
    sourceCurrency?: string;
    fxRateMicros?: number;
    fxRateDate?: string;
    fxSource?: string;
    providerRef?: string;
    occurredAt?: Date;
  } = {},
): Promise<SaleEvent> {
  const gross = opts.grossCents ?? 499;
  const values: typeof saleEventsTable.$inferInsert = {
    id: rid(),
    userId,
    eventType: opts.eventType ?? "crypto_purchase",
    productLabel: opts.productLabel ?? "Lucky Break",
    paymentMethod: opts.paymentMethod ?? "crypto",
    isComp: opts.isComp ?? false,
    grossCents: gross,
    gstCents: opts.gstCents ?? 22,
    pstCents: opts.pstCents ?? 31,
    netCents: opts.netCents ?? gross - 22 - 31,
    gstRateBps: opts.gstRateBps ?? 500,
    pstRateBps: opts.pstRateBps ?? 700,
    sourceGrossCents: opts.sourceGrossCents ?? gross,
    sourceCurrency: opts.sourceCurrency ?? "USD",
    fxRateMicros: opts.fxRateMicros ?? 1_000_000,
    fxRateDate: opts.fxRateDate ?? "2026-01-01",
    fxSource: opts.fxSource ?? "bank_of_canada",
    providerRef: opts.providerRef ?? `ref_${rid()}`,
    occurredAt: opts.occurredAt ?? new Date(),
  };
  const [row] = await db.insert(saleEventsTable).values(values).returning();
  return row;
}

/**
 * Force a pass to be expired by back-dating its start so it falls outside its
 * own duration window. Lifetime passes (null duration) never expire and are
 * left untouched.
 */
export async function expirePass(passId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(passesTable)
    .where(eq(passesTable.id, passId))
    .limit(1);
  if (!row || row.durationSeconds === null) return;
  const startedAt = new Date(Date.now() - (row.durationSeconds + 60) * 1000);
  await db
    .update(passesTable)
    .set({ startedAt })
    .where(eq(passesTable.id, passId));
}

/** Delete everything created by the factories during a test. */
export async function cleanup(): Promise<void> {
  if (createdGameIds.length > 0) {
    // Deleting the game cascades to its game_participants rows. Done before
    // users so guest participant rows (null userId) are also removed.
    await db.delete(gamesTable).where(inArray(gamesTable.id, createdGameIds));
    createdGameIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    // sale_events FK to users is ON DELETE SET NULL (the ledger must outlive an
    // account), so rows are NOT cascaded — delete them explicitly first or they
    // leak (orphaned with userId=null) across tests.
    await db
      .delete(saleEventsTable)
      .where(inArray(saleEventsTable.userId, createdUserIds));
    // discount_redemptions has no FK to users, so remove those explicitly.
    // passes + subscriptions cascade on user delete.
    await db
      .delete(discountRedemptionsTable)
      .where(inArray(discountRedemptionsTable.userId, createdUserIds));
    // Gift codes minted by a created user carry issuedByUserId but are not in
    // createdCodes, so remove them here (cascades to their redemptions).
    await db
      .delete(discountCodesTable)
      .where(inArray(discountCodesTable.issuedByUserId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    createdUserIds.length = 0;
  }
  if (createdCodes.length > 0) {
    await db
      .delete(discountCodesTable)
      .where(inArray(discountCodesTable.code, createdCodes));
    createdCodes.length = 0;
  }
}
