/**
 * Shared blocklist filter for any user-supplied free text (HUD ad copy, custom
 * screen names, …). The list itself is owner-curated and read from the
 * environment (`BREAKBPM_BANNED_WORDS`, see config.ts) so it can be retuned
 * without a redeploy; this module is the pure matcher so the same rule applies
 * everywhere it's wired in.
 *
 * Matching is case-insensitive and combines three rules so glued/compound
 * evasions are caught without flagging the app's own vocabulary:
 *
 *  1. SHORT entries (≤3 chars, e.g. `ass`/`jew`/`sex`/`gay`) match only at
 *     LETTER boundaries — a standalone "ass" and digit/symbol-wrapped uses like
 *     "45ass56"/"ass!!" are caught, but words that merely contain the fragment
 *     ("passes"/"class"/"jewelry"/"Sussex"/"bass") are NOT. Three-letter
 *     fragments are too common inside innocent words to match as substrings.
 *  2. LONG entries (≥4 chars, e.g. `cunt`/`fuck`/`pussy`) match ANYWHERE, so a
 *     banned word glued onto other text ("cuntycounty", "fuckyou") is caught.
 *     4+ char sequences rarely occur inside unrelated words. (Trade-off: a long
 *     entry will also match real words that contain it — e.g. banning `cock`
 *     would flag "cocktail"/"peacock". Tune the list accordingly.)
 *  3. A whole letter-run composed ENTIRELY of banned words ("pussyass" =
 *     pussy+ass) is swapped wholesale, which catches concatenations of two
 *     banned words while leaving normal words intact ("assassin" leaves "in",
 *     so it is not fully composed and is spared).
 *
 * A banned entry can be a multi-word phrase (handled by rule 2). To catch a
 * one-off variant like "shitty", still add it explicitly.
 *
 * The preferred behaviour is to "clean" rather than reject: `cleanBannedWords`
 * swaps each blocked region for a random friendly emoji so a user's input is
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
 * Return the first banned word that appears in `text` (case-insensitive), or
 * `null` when the text is clean. Empty/blank banned entries are ignored. Use for
 * surfaces that must reject rather than clean.
 */
export function findBannedWord(
  text: string,
  banned: readonly string[],
): string | null {
  const spans = findBannedSpans(text, banned);
  return spans.length > 0 ? spans[0].word : null;
}

/**
 * Replace every banned region of `text` with a random friendly emoji, leaving
 * the surrounding text intact. Overlapping/abutting matches collapse into a
 * single emoji. The input is never rejected — clean text passes through
 * unchanged. Empty/blank banned entries are ignored.
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
