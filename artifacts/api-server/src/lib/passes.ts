import { db, passesTable, PASS_DURATIONS_SECONDS, type PassKind } from "@workspace/db";
import { newId } from "./ids";
import { PASS_PRICES } from "./paymentProvider";

export interface IssuePassInput {
  userId: string;
  kind: PassKind;
  source: "purchase" | "discount_code" | "grant";
  sourceRef?: string;
}

export async function issuePass(input: IssuePassInput) {
  const startedAt = new Date();
  const durationSeconds = PASS_DURATIONS_SECONDS[input.kind];
  const priceCents =
    input.source === "purchase" ? PASS_PRICES[input.kind].priceCents : 0;

  const [row] = await db
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
