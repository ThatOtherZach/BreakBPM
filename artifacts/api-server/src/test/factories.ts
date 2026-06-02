import { randomBytes } from "crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  passesTable,
  subscriptionsTable,
  discountCodesTable,
  discountRedemptionsTable,
  PASS_DURATIONS_SECONDS,
  type User,
  type Pass,
  type Subscription,
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

function rid(): string {
  return randomBytes(16).toString("hex");
}

/** A code guaranteed not to collide with seed/admin codes. */
export function uniqueCode(prefix = "TEST"): string {
  return `${prefix}${rid().slice(0, 12).toUpperCase()}`;
}

export async function createUser(): Promise<User> {
  const [user] = await db
    .insert(usersTable)
    .values({
      id: rid(),
      authProvider: "test",
      authSubject: `test_${rid()}`,
      screenName: `Tester_${rid().slice(0, 6)}`,
      email: null,
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
  opts: { maxRedemptions?: number | null; expiresAt?: Date | null } = {},
): Promise<void> {
  await db.insert(discountCodesTable).values({
    code,
    grantsPassKind,
    maxRedemptions: opts.maxRedemptions ?? null,
    expiresAt: opts.expiresAt ?? null,
  });
  createdCodes.push(code);
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

/** Delete everything created by the factories during a test. */
export async function cleanup(): Promise<void> {
  if (createdUserIds.length > 0) {
    // discount_redemptions has no FK to users, so remove those explicitly.
    // passes + subscriptions cascade on user delete.
    await db
      .delete(discountRedemptionsTable)
      .where(inArray(discountRedemptionsTable.userId, createdUserIds));
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
