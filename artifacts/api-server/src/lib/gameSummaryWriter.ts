import { and, eq } from "drizzle-orm";
import { db, gamesTable, gameParticipantsTable } from "@workspace/db";
import {
  buildGameSummary,
  extractDiscriminators,
  type SummaryParticipantInput,
} from "./gameSummary";

/**
 * Distill a just-finalized game into its authoritative summaries + denormalized
 * discriminator columns and persist them. This is the ONLY DB-touching wrapper
 * around the pure {@link buildGameSummary} — call it once per game, AFTER the
 * finalize CAS has won (so it reflects the committed, final `gameState`).
 *
 * `gameState` is optional: omit it on the finalize paths so the freshest
 * committed blob is re-read (it has the host-theme snapshot re-applied and any
 * SQL `jsonb_set` forfeit reason); the backfill passes the row it already holds
 * to avoid a redundant read. The game-level + per-slot writes run in one
 * transaction so a row never ends up with a game summary but missing slot
 * summaries (read paths treat an empty `{}` summary as "absent, not corrupt").
 *
 * Idempotent: re-running simply recomputes and overwrites the same values, so
 * the one-time backfill and a live finalize can both call it safely.
 */
export async function writeFinalizedSummary(
  gameId: string,
  gameState?: unknown,
): Promise<void> {
  let gs = gameState;
  if (gs === undefined) {
    const rows = await db
      .select({ gameState: gamesTable.gameState })
      .from(gamesTable)
      .where(eq(gamesTable.id, gameId))
      .limit(1);
    if (rows.length === 0) return;
    gs = rows[0].gameState;
  }

  const parts = await db
    .select({
      slotIndex: gameParticipantsTable.slotIndex,
      displayName: gameParticipantsTable.displayName,
      statsStartAt: gameParticipantsTable.statsStartAt,
      leftAt: gameParticipantsTable.leftAt,
    })
    .from(gameParticipantsTable)
    .where(eq(gameParticipantsTable.gameId, gameId));

  const input: SummaryParticipantInput[] = parts.map((p) => ({
    slotIndex: p.slotIndex,
    displayName: p.displayName,
    statsStartAt: p.statsStartAt,
    leftAt: p.leftAt,
  }));

  const { game, bySlot } = buildGameSummary(gs, input);
  const disc = extractDiscriminators(gs);

  await db.transaction(async (tx) => {
    await tx
      .update(gamesTable)
      .set({
        summary: game,
        sharkAggression: disc.sharkAggression,
        chaosMode: disc.chaosMode,
        ruleSet: disc.ruleSet,
        hostTheme: disc.hostTheme,
        endReason: disc.endReason,
      })
      .where(eq(gamesTable.id, gameId));
    for (const [slotIndex, summary] of bySlot) {
      await tx
        .update(gameParticipantsTable)
        .set({ summary })
        .where(
          and(
            eq(gameParticipantsTable.gameId, gameId),
            eq(gameParticipantsTable.slotIndex, slotIndex),
          ),
        );
    }
  });
}
