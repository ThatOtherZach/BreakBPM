import { and, eq, sql } from "drizzle-orm";
import {
  db,
  subscriptionsTable,
  type SubscriptionInterval,
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

export interface ActivateSubscriptionInput {
  userId: string;
  interval: SubscriptionInterval;
  source: "purchase" | "grant";
  currentPeriodEnd?: Date;
  provider?: string | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
}

/**
 * Insert a new active subscription row inside a caller-provided transaction.
 * The paid-through date defaults to one interval from now when the provider
 * doesn't supply one.
 */
export async function activateSubscriptionTx(
  tx: Pick<typeof db, "insert">,
  input: ActivateSubscriptionInput,
) {
  const startedAt = new Date();
  const currentPeriodEnd =
    input.currentPeriodEnd ?? addInterval(startedAt, input.interval);
  const priceCents =
    input.source === "purchase" ? SUBSCRIPTION_PRICES_CENTS[input.interval] : 0;

  const [row] = await tx
    .insert(subscriptionsTable)
    .values({
      id: newId(),
      userId: input.userId,
      status: "active",
      interval: input.interval,
      priceCents,
      startedAt,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      source: input.source,
      provider: input.provider ?? null,
      providerCustomerId: input.providerCustomerId ?? null,
      providerSubscriptionId: input.providerSubscriptionId ?? null,
    })
    .returning();
  return row;
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
