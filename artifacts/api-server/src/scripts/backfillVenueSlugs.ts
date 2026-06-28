/**
 * Back-fill `venues.slug` for every Verified Hall created before slugs existed
 * (or before this code reached the environment), so per-hall leaderboard URLs
 * can use the readable form instead of the opaque id.
 *
 * Idempotent: rows that already have a slug are skipped, and {@link ensureVenueSlug}
 * is concurrency-safe (guarded UPDATE + unique-index retry), so this can be
 * re-run any time. The read-path lazy self-heal covers any row a deploy serves
 * before this backfill runs.
 *
 * Run:  pnpm --filter @workspace/api-server run backfill:venue-slugs
 */
import { isNull } from "drizzle-orm";
import { db, venuesTable } from "@workspace/db";
import { ensureVenueSlug } from "../lib/venueSlugStore";

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: venuesTable.id,
      name: venuesTable.name,
      locality: venuesTable.locality,
      slug: venuesTable.slug,
    })
    .from(venuesTable)
    .where(isNull(venuesTable.slug));

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await ensureVenueSlug(row);
      ok++;
    } catch (err) {
      failed++;
      console.error(`Failed to slug venue ${row.id}:`, err);
    }
  }

  console.log(
    `Back-fill complete. Slug-less venues scanned=${rows.length}, slugged=${ok}, failed=${failed}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Back-fill failed:", err);
    process.exit(1);
  });
