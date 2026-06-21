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
 * Matching is case-insensitive and combines three rules (keep in lockstep with
 * the server matcher):
 *  1. SHORT entries (≤3 chars, e.g. `ass`) match only at LETTER boundaries, so
 *     "45ass56" is caught but "passes"/"class"/"jewelry" are not.
 *  2. LONG entries (≥4 chars, e.g. `cunt`/`pussy`) match ANYWHERE, so a banned
 *     word glued onto other text ("cuntycounty") is caught.
 *  3. A whole letter-run composed ENTIRELY of banned words ("pussyass") is
 *     swapped wholesale, catching concatenations while sparing "assassin".
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

/** A half-open `[start, end)` slice of the input flagged for redaction. */
type BannedSpan = { start: number; end: number; word: string };

/** Banned words below this length match only at letter boundaries (rule 1);
 * at or above it they match anywhere (rule 2). 3-letter fragments are too
 * common inside innocent words to match as substrings. */
const SUBSTRING_MIN_LENGTH = 4;

/** Trim, lowercase, drop blanks, and de-dupe the owner-curated list. */
function normalizeBanned(banned: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const entry of banned) {
    const word = entry.trim().toLowerCase();
    if (word) seen.add(word);
  }
  return [...seen];
}

/** True when `token` (already lowercased) can be tiled EXACTLY by two or more
 * banned words back-to-back (e.g. "pussyass" = pussy+ass). A single banned word
 * is excluded here — rules 1/2 already cover standalone words — so this rule
 * only ever fires on genuine concatenations. */
function isConcatenatedBan(token: string, words: readonly string[]): boolean {
  const n = token.length;
  // segs[i] = fewest banned words needed to tile token[0..i); -1 = unreachable.
  const segs = new Array<number>(n + 1).fill(-1);
  segs[0] = 0;
  for (let i = 0; i < n; i++) {
    if (segs[i] < 0) continue;
    for (const w of words) {
      const end = i + w.length;
      if (end <= n && token.startsWith(w, i)) {
        if (segs[end] < 0 || segs[i] + 1 < segs[end]) segs[end] = segs[i] + 1;
      }
    }
  }
  return segs[n] >= 2;
}

/** Collect every region of `text` that should be redacted, per the three rules
 * documented at the top of this file. Spans may overlap/abut; callers merge. */
function findBannedSpans(
  text: string,
  banned: readonly string[],
): BannedSpan[] {
  if (!text) return [];
  const words = normalizeBanned(banned);
  if (words.length === 0) return [];
  const spans: BannedSpan[] = [];

  for (const word of words) {
    if (word.length >= SUBSTRING_MIN_LENGTH) {
      // Rule 2: long entries match anywhere.
      const re = new RegExp(escapeRegExp(word), "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        spans.push({ start: m.index, end: m.index + word.length, word });
      }
    } else {
      // Rule 1: short entries match only at letter boundaries (digits/symbols
      // count as boundaries, so "45ass56"/"ass!!" are still caught).
      const re = new RegExp(
        `(^|[^a-z])(${escapeRegExp(word)})(?=[^a-z]|$)`,
        "gi",
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const start = m.index + (m[1] ? m[1].length : 0);
        spans.push({ start, end: start + word.length, word });
      }
    }
  }

  // Rule 3: a whole letter-run made up entirely of banned words.
  const tokenRe = /[a-z]+/gi;
  let t: RegExpExecArray | null;
  while ((t = tokenRe.exec(text)) !== null) {
    const token = t[0];
    if (token.length >= 2 && isConcatenatedBan(token.toLowerCase(), words)) {
      spans.push({ start: t.index, end: t.index + token.length, word: token });
    }
  }

  return spans.sort((a, b) => a.start - b.start || b.end - a.end);
}

/**
 * Replace every banned region of `text` with a random friendly emoji, leaving
 * surrounding text intact. Overlapping/abutting matches collapse into a single
 * emoji. Clean text passes through unchanged; empty/blank entries are ignored.
 */
export function cleanBannedWords(
  text: string,
  banned: readonly string[],
): string {
  if (!text) return text;
  const spans = findBannedSpans(text, banned);
  if (spans.length === 0) return text;

  let out = "";
  let cursor = 0;
  let regionEnd = -1;
  for (const span of spans) {
    if (span.start > regionEnd) {
      // New region: flush the clean run before it and emit one emoji.
      out += text.slice(cursor, span.start) + randomSwapEmoji();
      cursor = span.end;
      regionEnd = span.end;
    } else if (span.end > regionEnd) {
      // Overlaps/abuts the current region — extend it, no extra emoji.
      cursor = span.end;
      regionEnd = span.end;
    }
  }
  out += text.slice(cursor);
  return out;
}

/** Cap for a free-typed player name. */
export const MAX_PLAYER_NAME_LENGTH = 35;

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
