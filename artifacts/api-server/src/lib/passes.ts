import { db, passesTable, PASS_DURATIONS_SECONDS, type PassKind } from "@workspace/db";
import { newId } from "./ids";
import { PASS_PRICES } from "./paymentProvider";

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
    input.source === "purchase" ? PASS_PRICES[input.kind].priceCents : 0;

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
