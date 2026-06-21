/**
 * Shared blocklist filter for any user-supplied free text (HUD ad copy, custom
 * screen names, …). The list itself is owner-curated and read from the
 * environment (`BREAKBPM_BANNED_WORDS`, see config.ts) so it can be retuned
 * without a redeploy; this module is the pure matcher so the same rule applies
 * everywhere it's wired in.
 *
 * Matching is case-insensitive and uses LETTER boundaries: a banned word matches
 * unless it's directly touching another letter. So banning `ass` catches a
 * standalone "ass" AND digit/symbol-wrapped uses like "45ass56" or "ass!!", but
 * NOT the app's own vocabulary like "passes"/"class"/"grass" (letters on either
 * side). A banned entry can be a multi-word phrase. To catch a variant like
 * "shitty", add it explicitly.
 *
 * The preferred behaviour is to "clean" rather than reject: `cleanBannedWords`
 * swaps each blocked word for a random friendly emoji so a user's input is
 * never refused — it's just tidied up — while `findBannedWord` remains for
 * surfaces that can't render emoji (e.g. URL-safe handles).
 */

/** Escape a string so it can be embedded literally inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Friendly emojis a blocked word is swapped for. Kept playful + on-brand (8-ball
 * leads) so a "cleaned" ad reads as a fun redaction rather than a censor bar.
 */
const SWAP_EMOJIS = [
  "🎱",
  "🌟",
  "🔥",
  "✨",
  "🎯",
  "🎲",
  "🍀",
  "🌈",
  "⭐",
  "🪄",
  "🎨",
  "🦄",
  "🐳",
  "🚀",
  "💫",
  "🎪",
] as const;

function randomSwapEmoji(): string {
  return SWAP_EMOJIS[Math.floor(Math.random() * SWAP_EMOJIS.length)];
}

/** Build the letter-boundary matcher for one banned entry: the word matches
 * unless a LETTER sits directly on either side, so digit/symbol-wrapped uses
 * ("45ass56") are caught while real words ("passes") are not. The trailing
 * boundary is a lookahead so adjacent matches like "ass ass" both get caught. */
function bannedWordRegExp(word: string, flags: string): RegExp {
  return new RegExp(
    `(^|[^a-z])(${escapeRegExp(word)})(?=[^a-z]|$)`,
    flags,
  );
}

/**
 * Return the first banned word that appears (as a whole word, case-insensitive)
 * in `text`, or `null` when the text is clean. Empty/blank banned entries are
 * ignored. Use for surfaces that must reject rather than clean.
 */
export function findBannedWord(
  text: string,
  banned: readonly string[],
): string | null {
  if (!text) return null;
  for (const entry of banned) {
    const word = entry.trim().toLowerCase();
    if (!word) continue;
    if (bannedWordRegExp(word, "i").test(text)) return word;
  }
  return null;
}

/**
 * Replace every whole-word occurrence of a banned word with a random friendly
 * emoji, leaving the surrounding text (and the boundary character before the
 * word) intact. The input is never rejected — clean text passes through
 * unchanged. Empty/blank banned entries are ignored.
 */
export function cleanBannedWords(
  text: string,
  banned: readonly string[],
): string {
  if (!text) return text;
  let out = text;
  for (const entry of banned) {
    const word = entry.trim().toLowerCase();
    if (!word) continue;
    out = out.replace(
      bannedWordRegExp(word, "gi"),
      (_match, pre: string) => `${pre}${randomSwapEmoji()}`,
    );
  }
  return out;
}
