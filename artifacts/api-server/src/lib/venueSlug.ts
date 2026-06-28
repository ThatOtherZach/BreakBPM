/**
 * Pure helpers to derive a short, readable, URL-safe slug for a Verified Hall
 * (e.g. "Sneaky Petes" → "sneaky-petes"; any non-alphanumeric run, apostrophes
 * included, collapses to a single hyphen). Side-effect free so they can be
 * unit-tested in isolation; the DB-touching mint/heal logic lives in
 * `venueSlugStore.ts`.
 */

/** Slug used when a name reduces to nothing (e.g. all punctuation/emoji). */
const FALLBACK_SLUG = "hall";

/**
 * Cap the name-derived base so a slug stays short and there's always room to
 * append a disambiguating suffix (city token or "-2") without re-truncation,
 * which guarantees {@link buildVenueSlug}'s numeric loop terminates.
 */
const MAX_BASE_LENGTH = 48;

/** Cap the locality tiebreaker token so the combined slug stays reasonable. */
const MAX_CITY_LENGTH = 24;

/**
 * Normalize arbitrary text into a kebab-case ASCII slug fragment: strip
 * diacritics, lowercase, collapse every run of non-alphanumerics to a single
 * hyphen, and trim leading/trailing hyphens. Returns "" when nothing survives.
 */
export function slugifyText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The name-only base, capped and trimmed, falling back when empty. */
function baseSlug(name: string): string {
  const s = slugifyText(name).slice(0, MAX_BASE_LENGTH).replace(/-+$/g, "");
  return s || FALLBACK_SLUG;
}

/** First locality token as a short slug fragment ("Los Angeles, US" → "los-angeles"). */
function cityToken(locality: string | null | undefined): string {
  if (!locality) return "";
  return slugifyText(locality.split(",")[0] ?? "")
    .slice(0, MAX_CITY_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * Build a unique slug for a venue, disambiguating against the set of slugs
 * already taken (case-insensitive). Resolution order:
 *   1. the name base ("sneaky-petes")
 *   2. name + city token ("sneaky-petes-portland")
 *   3. name + numeric suffix ("sneaky-petes-2", "-3", …)
 * The numeric loop always terminates because the base is length-capped, so
 * appended suffixes are never truncated away.
 */
export function buildVenueSlug(
  name: string,
  locality: string | null | undefined,
  taken: Iterable<string | null | undefined>,
): string {
  const used = new Set<string>();
  for (const s of taken) if (s) used.add(s.toLowerCase());

  const base = baseSlug(name);
  if (!used.has(base)) return base;

  const city = cityToken(locality);
  if (city) {
    const withCity = `${base}-${city}`;
    if (!used.has(withCity)) return withCity;
  }

  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
