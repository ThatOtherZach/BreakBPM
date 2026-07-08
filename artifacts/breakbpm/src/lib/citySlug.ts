/**
 * Client-side slug helper for City Leaderboard URLs so links read
 * "/leaderboard/city/vancouver-canada" instead of the percent-encoded
 * "Vancouver%2C%20Canada". Must stay in lockstep with the server's
 * `slugifyText` in `artifacts/api-server/src/lib/venueSlug.ts` (the city
 * route resolves the slug back to the real locality by comparing slug
 * forms; exact locality matches always win, so legacy encoded URLs keep
 * working).
 */
export function citySlug(locality: string): string {
  return locality
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** City-board path for a locality, slug form ("" guards to the encoded form). */
export function cityBoardPath(locality: string): string {
  const slug = citySlug(locality);
  return `/leaderboard/city/${slug || encodeURIComponent(locality)}`;
}

/**
 * Human-ish fallback when only the slug is known (signed-out hero before the
 * auth-gated city query returns): "vancouver-canada" → "Vancouver Canada".
 * Comma placement isn't recoverable, so no country split is attempted.
 */
export function prettifyCitySlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
