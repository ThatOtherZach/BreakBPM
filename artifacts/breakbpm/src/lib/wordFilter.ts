/**
 * Client-side mirror of the server's blocklist cleaner
 * (`api-server/src/lib/wordFilter.ts`). The owner-curated list itself is
 * delivered to the client via `GET /config` (`bannedWords`), so this module is
 * just the pure matcher used to "clean" in-game player names AT THE INPUT LAYER.
 *
 * Why clean here rather than server-side: a player name propagates into every
 * shot-log entry (which is keyed by the player's name for per-player BPM). The
 * swap picks a RANDOM emoji per call, so cleaning the same name independently in
 * two places would produce two different emoji and break that name match. The
 * only consistent place is the single source — the name input — before the name
 * ever flows into game state and the shot log.
 *
 * Matching is case-insensitive and WHOLE-WORD, so banning `ass` swaps a
 * standalone "ass" but never the app's own vocabulary ("passes"/"class"). Keep
 * this in lockstep with the server matcher.
 */

/** Escape a string so it can be embedded literally inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Friendly emojis a blocked word is swapped for (8-ball leads), matching the
 * server set so a cleaned name reads as a playful redaction, not a censor bar.
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

/** Whole-word matcher for one banned entry (trailing boundary is a lookahead so
 * adjacent matches like "ass ass" both get caught). */
function bannedWordRegExp(word: string, flags: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])(${escapeRegExp(word)})(?=[^a-z0-9]|$)`, flags);
}

/**
 * Replace every whole-word occurrence of a banned word with a random friendly
 * emoji, leaving surrounding text (and the boundary char before the word)
 * intact. Clean text passes through unchanged; empty/blank entries are ignored.
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
