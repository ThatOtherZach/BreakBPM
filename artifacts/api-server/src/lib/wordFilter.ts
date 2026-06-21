/**
 * Shared blocklist filter for any user-supplied free text (HUD ad copy, custom
 * screen names, …). The list itself is owner-curated and read from the
 * environment (`BREAKBPM_BANNED_WORDS`, see config.ts) so it can be retuned
 * without a redeploy; this module is the pure matcher so the same rule applies
 * everywhere it's wired in.
 *
 * Matching is case-insensitive and WHOLE-WORD (word boundaries), so banning
 * `ass` blocks a standalone "ass" but NOT the app's own vocabulary like
 * "passes"/"class"/"grass". A banned entry can be a multi-word phrase. To catch
 * a variant like "shitty", add it to the list explicitly.
 */

/** Escape a string so it can be embedded literally inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Return the first banned word that appears (as a whole word, case-insensitive)
 * in `text`, or `null` when the text is clean. Empty/blank banned entries are
 * ignored. Pass the owner-curated list from `bannedWords()` in config.ts.
 */
export function findBannedWord(
  text: string,
  banned: readonly string[],
): string | null {
  if (!text) return null;
  for (const entry of banned) {
    const word = entry.trim().toLowerCase();
    if (!word) continue;
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}([^a-z0-9]|$)`, "i");
    if (re.test(text)) return word;
  }
  return null;
}
