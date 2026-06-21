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
 * Matching is case-insensitive and uses LETTER boundaries, so banning `ass`
 * swaps a standalone "ass" AND digit/symbol-wrapped uses like "45ass56", but
 * never the app's own vocabulary ("passes"/"class") where letters sit on either
 * side. Keep `cleanBannedWords` in lockstep with the server matcher.
 *
 * `sanitizePlayerName` is the client-only entry point for the name field: on top
 * of the banned-word clean it strips invisible/control/bidi spoofing chars,
 * emoji-swaps URLs and markup ("no funny business"), and caps length. It has no
 * server mirror — player-name policy is enforced once, here, at the input.
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

/** Letter-boundary matcher for one banned entry: the word matches unless a
 * LETTER sits directly on either side, so digit/symbol-wrapped uses ("45ass56")
 * are caught while real words ("passes") are not. The trailing boundary is a
 * lookahead so adjacent matches like "ass ass" both get caught. */
function bannedWordRegExp(word: string, flags: string): RegExp {
  return new RegExp(`(^|[^a-z])(${escapeRegExp(word)})(?=[^a-z]|$)`, flags);
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

/** Cap for a free-typed player name, aligned with the screen-name ceiling so a
 * typed name and a generated one share the same length budget. */
export const MAX_PLAYER_NAME_LENGTH = 125;

// Invisible, control, and bidi-override characters — used for spoofing or to
// break layout. They have no place in a display name, so strip them outright.
const INVISIBLE_OR_CONTROL =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

// "Funny business": HTML/markup tags and URL-like runs (scheme://, www., or a
// bare domain.tld with optional path). Each whole run is swapped for one emoji.
const URL_OR_MARKUP =
  /(<[^>]*>?|\b\w+:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|net|org|io|gg|co|app|dev|xyz|info|biz|tv|me|ly|us|ca|uk|gov|edu)\b(?:\/\S*)?)/gi;

/**
 * Sanitize a free-typed player name down to plain display text: drop invisible/
 * control/bidi chars, emoji-swap any URL or markup run, strip any residual angle
 * brackets, run the banned-word cleaner, collapse whitespace, and cap length.
 * Deterministic except for the emoji choice — so, like `cleanBannedWords`, apply
 * it ONCE at the input source (see header) so the result is stable downstream.
 */
export function sanitizePlayerName(
  raw: string,
  banned: readonly string[],
): string {
  if (!raw) return raw;
  let out = raw.replace(INVISIBLE_OR_CONTROL, "");
  out = out.replace(URL_OR_MARKUP, () => randomSwapEmoji());
  out = out.replace(/[<>]/g, "");
  out = cleanBannedWords(out, banned);
  out = out.replace(/\s+/g, " ").trim();
  // Slice by code points so a multi-unit emoji is never cut in half.
  const points = Array.from(out);
  return points.length > MAX_PLAYER_NAME_LENGTH
    ? points.slice(0, MAX_PLAYER_NAME_LENGTH).join("")
    : out;
}
