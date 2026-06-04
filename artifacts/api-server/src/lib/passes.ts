import { and, eq } from "drizzle-orm";
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
 * double-issue: a pass already issued for the same (user, sourceRef) is
 * returned as-is. Buying Lifetime stops any active subscription from renewing,
 * in the same transaction (the mutual-exclusion rule).
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
        eq(passesTable.userId, input.userId),
        eq(passesTable.sourceRef, input.sourceRef),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return { pass: existing[0], deduped: true };
  }

  const pass = await issuePassTx(tx, {
    userId: input.userId,
    kind: input.kind,
    source: "purchase",
    sourceRef: input.sourceRef,
  });
  if (pass.kind === "lifetime") {
    await stopRenewingActiveSubscriptionsTx(tx, input.userId);
  }
  return { pass, deduped: false };
}
