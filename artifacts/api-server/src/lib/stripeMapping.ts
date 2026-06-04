import type Stripe from "stripe";
import type { SubscriptionInterval, SubscriptionStatus } from "@workspace/db";

/**
 * Helpers that translate a Stripe Subscription object into the fields our own
 * `subscriptions` table tracks. Shared by the payment provider (verify path)
 * and the webhook reconciler so the two stay in lockstep.
 *
 * Stripe moved `current_period_end` from the subscription top level to the
 * subscription *item* in recent API versions, so we read it defensively from
 * both spots.
 */
export function readSubscriptionInterval(
  sub: Stripe.Subscription,
): SubscriptionInterval | null {
  const recur = sub.items?.data?.[0]?.price?.recurring?.interval;
  if (recur === "month" || recur === "year") return recur;
  const meta = sub.metadata?.interval;
  return meta === "month" || meta === "year" ? meta : null;
}

export function readSubscriptionPeriodEnd(
  sub: Stripe.Subscription,
): Date | undefined {
  const top = (sub as unknown as { current_period_end?: number })
    .current_period_end;
  const item = sub.items?.data?.[0] as
    | { current_period_end?: number }
    | undefined;
  const epoch =
    typeof top === "number"
      ? top
      : typeof item?.current_period_end === "number"
        ? item.current_period_end
        : undefined;
  return typeof epoch === "number" ? new Date(epoch * 1000) : undefined;
}

export function mapSubscriptionStatus(
  s: Stripe.Subscription.Status,
): SubscriptionStatus {
  switch (s) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    default:
      return "canceled";
  }
}
