import { and, eq, sql } from "drizzle-orm";
import {
  db,
  passesTable,
  PASS_DURATIONS_SECONDS,
  type Pass,
  type PassKind,
} from "@workspace/db";
import { newId } from "./ids";
import { PASS_PRICES_CENTS } from "./pricing";
import { stopRenewingActiveSubscriptionsTx } from "./subscriptions";

export interface IssuePassInput {
  userId: string;
  kind: PassKind;
  source: "purchase" | "discount_code" | "grant";
  sourceRef?: string;
}

/**
 * Issue a pass row inside a caller-provided transaction. Used by the
 * redeem/purchase flows so the pass + the redemption record are written
 * atomically.
 */
export async function issuePassTx(
  tx: Pick<typeof db, "insert">,
  input: IssuePassInput,
) {
  const startedAt = new Date();
  const durationSeconds = PASS_DURATIONS_SECONDS[input.kind];
  const priceCents =
    input.source === "purchase" ? PASS_PRICES_CENTS[input.kind] : 0;

  const [row] = await tx
    .insert(passesTable)
    .values({
      id: newId(),
      userId: input.userId,
      kind: input.kind,
      startedAt,
      durationSeconds,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      priceCents,
    })
    .returning();
  return row;
}

/** Convenience wrapper for non-transactional callers. */
export async function issuePass(input: IssuePassInput) {
  return issuePassTx(db, input);
}

export interface GrantPurchasedPassInput {
  userId: string;
  kind: PassKind;
  /** Stripe payment-intent id — the idempotency key for this purchase. */
  sourceRef: string;
}

/**
 * Idempotently grant a purchased pass. Both the verify endpoint (UX) and the
 * webhook (authoritative) call this on a confirmed payment, so it must not
 * double-issue. Dedup is keyed GLOBALLY on the Stripe payment reference
 * (sourceRef = payment_intent), which uniquely identifies one payment by one
 * user — combined with the partial unique index on (source_ref WHERE
 * source='purchase'), this holds even when verify and the webhook race each
 * other on the post-checkout redirect. Buying Lifetime stops any active
 * subscription from renewing, in the same transaction (mutual exclusion).
 *
 * Note: this grants ACCESS only. Telling Stripe to stop a real subscription
 * from renewing on Lifetime is the caller's job (see
 * stopRenewingStripeSubscriptions in paymentProvider) and runs OUTSIDE this
 * transaction since it makes a network call.
 */
export async function grantPurchasedPassTx(
  tx: Pick<typeof db, "insert" | "update" | "select">,
  input: GrantPurchasedPassInput,
): Promise<{ pass: Pass; deduped: boolean }> {
  const existing = await tx
    .select()
    .from(passesTable)
    .where(
      and(
        eq(passesTable.sourceRef, input.sourceRef),
        eq(passesTable.source, "purchase"),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return { pass: existing[0], deduped: true };
  }

  const [pass] = await tx
    .insert(passesTable)
    .values({
      id: newId(),
      userId: input.userId,
      kind: input.kind,
      startedAt: new Date(),
      durationSeconds: PASS_DURATIONS_SECONDS[input.kind],
      source: "purchase",
      sourceRef: input.sourceRef,
      priceCents: PASS_PRICES_CENTS[input.kind],
    })
    .onConflictDoNothing({
      target: passesTable.sourceRef,
      where: sql`${passesTable.source} = 'purchase'`,
    })
    .returning();

  // A concurrent grant (verify vs webhook firing together) won the insert
  // race and the unique index rejected ours. Return the row that won — same
  // payment, no double-grant. We re-read by sourceRef rather than (user,
  // sourceRef) so a misattributed concurrent insert can never slip a second
  // pass through.
  if (!pass) {
    const [row] = await tx
      .select()
      .from(passesTable)
      .where(
        and(
          eq(passesTable.sourceRef, input.sourceRef),
          eq(passesTable.source, "purchase"),
        ),
      )
      .limit(1);
    return { pass: row, deduped: true };
  }

  if (pass.kind === "lifetime") {
    await stopRenewingActiveSubscriptionsTx(tx, input.userId);
  }
  return { pass, deduped: false };
}
