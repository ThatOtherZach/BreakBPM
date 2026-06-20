/**
 * Shared sanitization for user/admin-supplied HUD ad copy. Ads render as plain
 * text inside the live game HUD, so we strip anything HTML-ish, flatten
 * whitespace, and hard-cap length. Used by BOTH the admin create path and the
 * user ad-purchase path so the same rules apply no matter who authored the ad.
 */

/** Max rendered lengths (kept in lockstep with the OpenAPI maxLength bounds). */
export const AD_HEADLINE_MAX = 60;
export const AD_TAGLINE_MAX = 120;

/**
 * Strip tag-like sequences and stray angle brackets, collapse whitespace runs
 * to a single space, trim, and cap to `max`. Returns plain, display-safe text.
 */
export function sanitizeAdField(raw: string, max: number): string {
  return raw
    .replace(/<[^>]*>/g, " ") // drop <...> tag-like runs
    .replace(/[<>]/g, " ") // drop any stray angle brackets
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export type SanitizedAdCopy =
  | { ok: true; headline: string; tagline: string }
  | { ok: false; message: string };

/**
 * Sanitize a headline + tagline pair to display-safe, length-capped text.
 * Returns `{ ok: false, message }` when either field is empty after cleaning,
 * so the same emptiness rule applies on both the admin and user create paths.
 */
export function sanitizeAdCopy(
  headline: string,
  tagline: string,
): SanitizedAdCopy {
  const cleanHeadline = sanitizeAdField(headline, AD_HEADLINE_MAX);
  const cleanTagline = sanitizeAdField(tagline, AD_TAGLINE_MAX);
  if (!cleanHeadline) {
    return { ok: false, message: "Add a headline for your ad." };
  }
  if (!cleanTagline) {
    return { ok: false, message: "Add a tagline for your ad." };
  }
  return { ok: true, headline: cleanHeadline, tagline: cleanTagline };
}
