/**
 * Shared "Read in your language" handoff used by the About and Legal pages.
 *
 * The markdown sources that render those pages are hosted publicly on GitHub
 * raw, so an AI assistant can fetch and translate them with zero drift and no
 * extra endpoint/build step. This module centralises the browser-language
 * detection, prompt building, and assistant-link construction so every surface
 * stays in lockstep.
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

/**
 * Auto-submitting prompt that tells an AI to read + translate the document at
 * `rawUrl`. `subject` describes the document (e.g. "BreakBPM billiards app
 * guide" or `BreakBPM legal document ("Terms of Service")`).
 */
export function buildTranslatePrompt(
  subject: string,
  rawUrl: string,
  lang: DetectedLanguage,
): string {
  if (lang.isEnglish || !lang.name) {
    return `Read this ${subject} and translate it into the language I ask for — please ask me which language first. Keep the original headings and structure. Here it is: ${rawUrl}`;
  }
  return `Read this ${subject} and translate the entire thing into ${lang.name}, keeping the original headings and structure. Here it is: ${rawUrl}`;
}

export interface TranslateLinks {
  lang: DetectedLanguage;
  translateLabel: string;
  perplexityUrl: string;
  chatgptUrl: string;
}

/**
 * Build the detected language plus ready-to-use Perplexity (primary) and
 * ChatGPT (secondary) handoff URLs and a localized button label.
 * `englishLabel` is the fallback button text shown when the reader's browser is
 * already English (or the language name can't be resolved).
 */
export function buildTranslateLinks(
  subject: string,
  rawUrl: string,
  englishLabel = '🌐 Translate',
): TranslateLinks {
  const lang = detectLanguage();
  const q = encodeURIComponent(buildTranslatePrompt(subject, rawUrl, lang));
  return {
    lang,
    translateLabel:
      lang.isEnglish || !lang.name ? englishLabel : `🌐 Translate to ${lang.name}`,
    perplexityUrl: `https://www.perplexity.ai/search?q=${q}`,
    chatgptUrl: `https://chatgpt.com/?q=${q}`,
  };
}
