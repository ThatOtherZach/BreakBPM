/**
 * Back-fill `games.summary` + the denormalized discriminator columns and each
 * `game_participants.summary` for every already-finalized game, so the bulk
 * stats/leaderboard/history/profile read paths can stop parsing the big
 * `gameState.shotLog`.
 *
 * Idempotent: {@link writeFinalizedSummary} recomputes and overwrites the same
 * values every run, so this can be re-run any time (e.g. to repair a row whose
 * best-effort live finalize write failed). The raw `gameState` blob is never
 * touched — this only distills it.
 *
 * Run:  pnpm --filter @workspace/api-server run backfill:game-summaries
 */
import { isNotNull } from "drizzle-orm";
import { db, gamesTable } from "@workspace/db";
import { writeFinalizedSummary } from "../lib/gameSummaryWriter";

async function main(): Promise<void> {
  const rows = await db
    .select({ id: gamesTable.id, gameState: gamesTable.gameState })
    .from(gamesTable)
    .where(isNotNull(gamesTable.endedAt));

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      // Pass the row we already hold so the writer skips a redundant re-read.
      await writeFinalizedSummary(row.id, row.gameState);
      ok++;
    } catch (err) {
      failed++;
      console.error(`Failed to summarize game ${row.id}:`, err);
    }
  }

  console.log(
    `Back-fill complete. Finalized games scanned=${rows.length}, summarized=${ok}, failed=${failed}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Back-fill failed:", err);
    process.exit(1);
  });
