/**
 * DB-touching slug minting / self-heal for Verified Halls. Wraps the pure
 * {@link buildVenueSlug} helper with the read-then-write logic and the
 * unique-index race handling that admin-create, the backfill script, and the
 * lazy read-path heal all share.
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, venuesTable } from "@workspace/db";
import { buildVenueSlug } from "./venueSlug";

/** Postgres unique-violation SQLSTATE — surfaced on `err.cause.code` via drizzle. */
const PG_UNIQUE_VIOLATION = "23505";

function pgCode(err: unknown): string | undefined {
  return (err as { cause?: { code?: string } } | null)?.cause?.code;
}

/** Every slug currently in use (lower-cased), for collision-free generation. */
async function takenSlugs(): Promise<string[]> {
  const rows = await db
    .select({ slug: venuesTable.slug })
    .from(venuesTable)
    .where(isNotNull(venuesTable.slug));
  return rows.map((r) => r.slug as string);
}

/**
 * Compute a unique slug for a not-yet-persisted venue from the current set of
 * taken slugs. The caller inserts it and should retry on a unique violation
 * (a concurrent create can grab the same slug between this read and the insert).
 */
export async function generateVenueSlug(
  name: string,
  locality: string | null | undefined,
): Promise<string> {
  return buildVenueSlug(name, locality, await takenSlugs());
}

/**
 * Return the venue's slug, minting + persisting one in place when it is missing
 * (lazy self-heal for rows created before slugs existed, or before the backfill
 * reached this environment). Idempotent and concurrency-safe:
 *   - the `slug IS NULL` guard means only the first writer fills the row; losers
 *     of a same-row race update zero rows and re-read the winner's slug;
 *   - a `23505` (a different venue grabbed the computed slug first) recomputes
 *     against the now-larger taken set and retries.
 */
export async function ensureVenueSlug(venue: {
  id: string;
  name: string;
  locality: string | null;
  slug: string | null;
}): Promise<string> {
  if (venue.slug) return venue.slug;

  for (let attempt = 0; attempt < 8; attempt++) {
    const slug = buildVenueSlug(venue.name, venue.locality, await takenSlugs());
    try {
      const [updated] = await db
        .update(venuesTable)
        .set({ slug })
        .where(and(eq(venuesTable.id, venue.id), isNull(venuesTable.slug)))
        .returning({ slug: venuesTable.slug });
      if (updated?.slug) return updated.slug;

      // Guard matched zero rows: another request healed this same venue first.
      const [fresh] = await db
        .select({ slug: venuesTable.slug })
        .from(venuesTable)
        .where(eq(venuesTable.id, venue.id))
        .limit(1);
      if (fresh?.slug) return fresh.slug;
    } catch (err) {
      // Slug collided with a different venue between the read and the write —
      // recompute against the larger taken set and try again.
      if (pgCode(err) !== PG_UNIQUE_VIOLATION) throw err;
    }
  }
  throw new Error(`Could not mint a unique slug for venue ${venue.id}`);
}
