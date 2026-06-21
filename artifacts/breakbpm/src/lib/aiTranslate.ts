/**
 * Shared "Read in your language" handoff used by the About and Legal pages.
 *
 * Each surface offers one "Copy Prompt" button that copies a self-contained
 * prompt — the full document text embedded inline (so the AI never has to fetch
 * a link) plus the canonical GitHub-raw URL as added context. The prompt offers
 * two things: a translation into the reader's language and a short TL;DR
 * summary (the default for English readers who just want the gist). This module
 * centralises the browser-language detection and prompt building so every
 * surface stays in lockstep.
 */

/** Base GitHub-raw URL for the breakbpm source tree (trailing slash included). */
export const RAW_BASE_URL =
  'https://raw.githubusercontent.com/ThatOtherZach/BreakBPM/main/artifacts/breakbpm/src/';

export interface DetectedLanguage {
  name: string;
  isEnglish: boolean;
}

/**
 * Resolve the reader's browser language into a human-readable English name.
 * Keeps the script subtag (so zh-TW → "Traditional Chinese", zh-CN →
 * "Simplified Chinese") but drops the region (avoids "French (France)").
 */
export function detectLanguage(): DetectedLanguage {
  const code =
    (typeof navigator !== 'undefined' &&
      (navigator.languages?.[0] || navigator.language)) ||
    'en';
  let base = code.split('-')[0].toLowerCase();
  let name = '';
  const display = (tag: string) => {
    try {
      return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) || '';
    } catch {
      return '';
    }
  };
  try {
    const loc = new Intl.Locale(code).maximize();
    base = loc.language;
    name = display(loc.script ? `${loc.language}-${loc.script}` : loc.language);
  } catch {
    name = display(base);
  }
  return { name, isEnglish: base === 'en' };
}

export interface CopyPrompt {
  lang: DetectedLanguage;
  /** The complete, ready-to-paste prompt (full document text embedded inline). */
  prompt: string;
}

/**
 * Build a single self-contained prompt the reader can paste into any AI
 * assistant (ChatGPT, Perplexity, Gemini, DeepSeek, …). The entire document
 * `body` is embedded inline so the assistant never has to fetch a link, and the
 * canonical GitHub-raw `rawUrl` is included as added context so it has a source
 * to follow up on. `subject` describes the document (e.g. "BreakBPM billiards
 * app guide" or `BreakBPM legal document ("Terms of Service")`).
 *
 * The prompt offers both a translation and a short TL;DR summary. Non-English
 * readers default to a translation into their language; English (or undetected)
 * readers default to a TL;DR — handy for anyone who just wants the gist — with
 * translation offered as the alternative.
 */
export function buildCopyPrompt(
  subject: string,
  rawUrl: string,
  body: string,
): CopyPrompt {
  const lang = detectLanguage();
  const translate = (target: string) =>
    `translate the ${subject} below into ${target}, keeping all headings, ` +
    `structure, markdown formatting, emojis, product names (BreakBPM, BPM) and ` +
    `URLs unchanged, and output only the translation`;
  const tldr = (target: string) =>
    `give me a short TL;DR — a plain-language summary of the key points in ` +
    `${target}, skipping the boilerplate`;

  const instruction =
    lang.isEnglish || !lang.name
      ? `Please ${tldr('English')}. If I'd rather read the whole document in ` +
        `another language, first ask me which language, then ` +
        `${translate('that language')}.`
      : `Please ${translate(lang.name)}. If I instead ask for a TL;DR, ` +
        `${tldr(lang.name)}.`;
  const context =
    ` The full text is included below; the canonical source is also at ` +
    `${rawUrl} if you need to re-check it.`;
  const prompt = `${instruction}${context}\n\n--- DOCUMENT START ---\n${body}\n--- DOCUMENT END ---\n\nSource: ${rawUrl}`;
  return { lang, prompt };
}
