/**
 * Shared "Read in your language" handoff used by the About and Legal pages.
 *
 * Each surface offers one "Copy Prompt" button that copies a self-contained
 * translation prompt — the full document text embedded inline (so the AI never
 * has to fetch a link) plus the canonical GitHub-raw URL as added context. This
 * module centralises the browser-language detection and prompt building so every
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
 * Build a single self-contained translation prompt the reader can paste into any
 * AI assistant (ChatGPT, Perplexity, Gemini, DeepSeek, …). The entire document
 * `body` is embedded inline so the assistant never has to fetch a link, and the
 * canonical GitHub-raw `rawUrl` is included as added context so it has a source
 * to follow up on. `subject` describes the document (e.g. "BreakBPM billiards
 * app guide" or `BreakBPM legal document ("Terms of Service")`).
 */
export function buildCopyPrompt(
  subject: string,
  rawUrl: string,
  body: string,
): CopyPrompt {
  const lang = detectLanguage();
  const target =
    lang.isEnglish || !lang.name
      ? 'the language I specify — please ask me which language first'
      : lang.name;
  const instruction =
    `Translate the ${subject} below into ${target}. Keep all headings, ` +
    `structure, markdown formatting, emojis, product names (BreakBPM, BPM) and ` +
    `URLs unchanged. Output only the translation, with no extra commentary. The ` +
    `full text is included below; the canonical source is also at ${rawUrl} if ` +
    `you need to re-check it.`;
  const prompt = `${instruction}\n\n--- DOCUMENT START ---\n${body}\n--- DOCUMENT END ---\n\nSource: ${rawUrl}`;
  return { lang, prompt };
}
