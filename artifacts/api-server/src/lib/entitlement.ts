import { eq, desc } from "drizzle-orm";
import {
  db,
  passesTable,
  subscriptionsTable,
  type Pass,
  type Subscription,
  type SubscriptionInterval,
  type SubscriptionStatus,
  type User,
} from "@workspace/db";

export type Tier = "public" | "account" | "pass";

export interface PassSummary {
  kind: "day" | "month" | "year" | "lifetime";
  startedAt: Date;
  expiresAt: Date;
  isLifetime: boolean;
}

export interface SubscriptionSummary {
  status: SubscriptionStatus;
  interval: SubscriptionInterval;
  /** Paid-through date. Renews on this date unless cancelAtPeriodEnd is set,
   * in which case access ends here. */
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

export interface Entitlement {
  tier: Tier;
  hasActivePass: boolean;
  /** null = no cap (full history). number = cap to N most recent. */
  historyVisibleLimit: number | null;
  activePass?: PassSummary;
  /** Present when an active recurring subscription grants entitlement. */
  activeSubscription?: SubscriptionSummary;
}

export const HISTORY_LIMIT_FREE_ACCOUNT = 3;

/**
 * Sentinel "expires" date for lifetime passes. The DB stores NULL duration
 * for lifetime; the API contract (OpenAPI) still requires `expiresAt`, so we
 * surface a far-future date. Clients should rely on `isLifetime: true`, not
 * this value, when rendering "Lifetime" vs a real expiry.
 */
const LIFETIME_EXPIRES_AT = new Date("9999-12-31T23:59:59.999Z");

function passSummary(p: Pass): PassSummary {
  const expiresAt =
    p.durationSeconds === null
      ? LIFETIME_EXPIRES_AT
      : new Date(p.startedAt.getTime() + p.durationSeconds * 1000);
  return {
    kind: p.kind as PassSummary["kind"],
    startedAt: p.startedAt,
    expiresAt,
    isLifetime: p.kind === "lifetime",
  };
}

function subscriptionSummary(s: Subscription): SubscriptionSummary {
  return {
    status: s.status as SubscriptionStatus,
    interval: s.interval as SubscriptionInterval,
    currentPeriodEnd: s.currentPeriodEnd,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
  };
}

/** All currently-active passes for a user, newest expiry first.
 * A pass is active iff it has been issued (`startedAt <= now`) and has not
 * yet expired (`expiresAt > now`). The startedAt guard matters for lifetime
 * passes — without a real expiry, a future-dated row would otherwise count
 * as active immediately. */
export async function getActivePasses(userId: string, now: Date = new Date()): Promise<PassSummary[]> {
  const all = await db
    .select()
    .from(passesTable)
    .where(eq(passesTable.userId, userId))
    .orderBy(desc(passesTable.startedAt));
  return all
    .map(passSummary)
    .filter((p) => p.startedAt <= now && p.expiresAt > now);
}

/**
 * The user's currently-entitling subscription, if any. A subscription grants
 * access while `status = 'active'` AND it is still within the paid-through
 * window (`currentPeriodEnd > now`). `cancelAtPeriodEnd` does NOT revoke
 * access early — the row stays active until the period actually ends. Returns
 * the latest period-end when multiple rows exist (defensive — there should
 * normally be at most one active subscription per user).
 */
export async function getActiveSubscription(
  userId: string,
  now: Date = new Date(),
): Promise<SubscriptionSummary | null> {
  const all = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .orderBy(desc(subscriptionsTable.currentPeriodEnd));
  const active = all.find(
    (s) => s.status === "active" && s.currentPeriodEnd > now,
  );
  return active ? subscriptionSummary(active) : null;
}

export async function computeEntitlement(user: User | null): Promise<Entitlement> {
  if (!user) {
    return { tier: "public", hasActivePass: false, historyVisibleLimit: 0 };
  }
  const [active, subscription] = await Promise.all([
    getActivePasses(user.id),
    getActiveSubscription(user.id),
  ]);

  // Either an active pass OR an active subscription grants the "pass" tier —
  // this is the single place that "either source grants access" lives.
  const hasActivePass = active.length > 0;
  if (!hasActivePass && !subscription) {
    return {
      tier: "account",
      hasActivePass: false,
      historyVisibleLimit: HISTORY_LIMIT_FREE_ACCOUNT,
    };
  }

  // Pick the pass with the latest expiry as "the" active pass shown in the UI.
  const headline = hasActivePass
    ? active.reduce((a, b) => (b.expiresAt > a.expiresAt ? b : a))
    : undefined;
  return {
    tier: "pass",
    hasActivePass,
    historyVisibleLimit: null,
    ...(headline ? { activePass: headline } : {}),
    ...(subscription ? { activeSubscription: subscription } : {}),
  };
}
