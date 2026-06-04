import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  subscriptionsTable,
  type Subscription,
  type SubscriptionInterval,
  type SubscriptionStatus,
} from "@workspace/db";
import { newId } from "./ids";
import { SUBSCRIPTION_PRICES_CENTS } from "./pricing";

/** Advance a date by one billing interval (used to compute the paid-through
 * date for a freshly-activated subscription). */
export function addInterval(from: Date, interval: SubscriptionInterval): Date {
  const d = new Date(from);
  if (interval === "month") d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
}

/**
 * Flag every currently-active subscription for a user to stop renewing. Used
 * when a subscribed user buys Lifetime — they keep access until the paid
 * period ends, but the subscription will not renew. Returns the number of
 * rows updated.
 */
export async function stopRenewingActiveSubscriptionsTx(
  tx: Pick<typeof db, "update">,
  userId: string,
): Promise<number> {
  const updated = await tx
    .update(subscriptionsTable)
    .set({ cancelAtPeriodEnd: true, canceledAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(subscriptionsTable.userId, userId),
        eq(subscriptionsTable.status, "active"),
        eq(subscriptionsTable.cancelAtPeriodEnd, false),
      ),
    )
    .returning({ id: subscriptionsTable.id });
  return updated.length;
}

/** Mark a subscription cancel-at-period-end (does not revoke access early). */
export async function cancelSubscriptionTx(
  tx: Pick<typeof db, "update">,
  userId: string,
): Promise<number> {
  return stopRenewingActiveSubscriptionsTx(tx, userId);
}

export interface UpsertPurchasedSubscriptionInput {
  userId: string;
  interval: SubscriptionInterval;
  /** Stripe subscription id — the idempotency key. */
  providerSubscriptionId: string;
  status?: SubscriptionStatus;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  provider?: string | null;
  providerCustomerId?: string | null;
}

/** Apply an incoming subscription event to an existing row, in place. */
async function applySubscriptionUpdateTx(
  tx: Pick<typeof db, "update">,
  existing: Subscription,
  input: UpsertPurchasedSubscriptionInput,
): Promise<Subscription> {
  const [updated] = await tx
    .update(subscriptionsTable)
    .set({
      status: input.status ?? existing.status,
      interval: input.interval,
      ...(input.currentPeriodEnd
        ? { currentPeriodEnd: input.currentPeriodEnd }
        : {}),
      ...(input.cancelAtPeriodEnd !== undefined
        ? { cancelAtPeriodEnd: input.cancelAtPeriodEnd }
        : {}),
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      ...(input.providerCustomerId !== undefined
        ? { providerCustomerId: input.providerCustomerId }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(subscriptionsTable.id, existing.id))
    .returning();
  return updated;
}

/**
 * Idempotently insert-or-update a subscription keyed on its Stripe
 * subscription id. Both the verify endpoint (UX) and the webhook
 * (authoritative) call this, so an existing row for the same
 * providerSubscriptionId is updated in place rather than duplicated. The
 * unique index on provider_subscription_id makes this safe even when verify
 * and the customer.subscription.* webhook race: the insert below uses
 * onConflictDoNothing, and on conflict we fall back to updating the row the
 * winner inserted (never a second row, never a lost event).
 */
export async function upsertPurchasedSubscriptionTx(
  tx: Pick<typeof db, "insert" | "update" | "select">,
  input: UpsertPurchasedSubscriptionInput,
): Promise<Subscription> {
  const existing = await tx
    .select()
    .from(subscriptionsTable)
    .where(
      eq(subscriptionsTable.providerSubscriptionId, input.providerSubscriptionId),
    )
    .limit(1);

  if (existing[0]) {
    return applySubscriptionUpdateTx(tx, existing[0], input);
  }

  const startedAt = new Date();
  const [inserted] = await tx
    .insert(subscriptionsTable)
    .values({
      id: newId(),
      userId: input.userId,
      status: input.status ?? "active",
      interval: input.interval,
      priceCents: SUBSCRIPTION_PRICES_CENTS[input.interval],
      startedAt,
      currentPeriodEnd:
        input.currentPeriodEnd ?? addInterval(startedAt, input.interval),
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      source: "purchase",
      provider: input.provider ?? null,
      providerCustomerId: input.providerCustomerId ?? null,
      providerSubscriptionId: input.providerSubscriptionId,
    })
    .onConflictDoNothing({
      target: subscriptionsTable.providerSubscriptionId,
    })
    .returning();

  if (inserted) return inserted;

  // A concurrent insert won the race; fetch its row and apply this event's
  // fields in place so the later event isn't dropped.
  const [row] = await tx
    .select()
    .from(subscriptionsTable)
    .where(
      eq(subscriptionsTable.providerSubscriptionId, input.providerSubscriptionId),
    )
    .limit(1);
  return applySubscriptionUpdateTx(tx, row, input);
}

/**
 * The Stripe subscription id of the user's current active subscription, if
 * any. Used as a fallback when cancelling so we can target the right Stripe
 * subscription without the caller threading the id through.
 */
export async function getActiveProviderSubscriptionId(
  userId: string,
): Promise<string | null> {
  const now = new Date();
  const rows = await db
    .select({
      providerSubscriptionId: subscriptionsTable.providerSubscriptionId,
    })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.userId, userId),
        eq(subscriptionsTable.status, "active"),
        sql`${subscriptionsTable.currentPeriodEnd} > ${now}`,
      ),
    )
    .orderBy(desc(subscriptionsTable.currentPeriodEnd))
    .limit(1);
  return rows[0]?.providerSubscriptionId ?? null;
}

/** True when the user has any active (entitling) subscription right now. */
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const now = new Date();
  const [row] = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.userId, userId),
        eq(subscriptionsTable.status, "active"),
        sql`${subscriptionsTable.currentPeriodEnd} > ${now}`,
      ),
    )
    .limit(1);
  return !!row;
}
