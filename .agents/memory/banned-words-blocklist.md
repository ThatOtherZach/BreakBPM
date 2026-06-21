---
name: Banned-words blocklist matching
description: Why the BREAKBPM_BANNED_WORDS filter matches whole words, not substrings, and where it is wired.
---

`BREAKBPM_BANNED_WORDS` is an owner-curated, comma-separated env list. It filters
user-supplied free text on two surfaces: HUD ad copy (headline + tagline) and the
custom screen-name change. The pure matcher is `wordFilter.ts` `findBannedWord`,
read via `config.bannedWords()`.

**Rule:** matching is WHOLE-WORD and case-insensitive
(`(^|[^a-z0-9])<word>([^a-z0-9]|$)`), not substring.

**Why:** this app's own vocabulary collides with naughty substrings — the product
literally sells "passes". Substring matching of a banned "ass" would silently
reject legitimate ad copy like "Day passes available" and break "class"/"grass".
Whole-word matching avoids those false positives at the cost of missing inflected
variants (e.g. "shitty" when only "shit" is listed) — those must be added to the
list explicitly. Separator-delimited forms like "x-ass-x" still match (hyphen is a
boundary); fully packed forms like "xassx" do not.

**How to apply:** wire the filter at `sanitizeAdCopy` (covers both ad-create paths)
and after the screen-name URL-safe regex (screen names are NOT admin-moderated, so
the filter is the only gate there). Ads ARE admin-moderated, so a slip-through is
caught by a human. If extending to other free-text inputs (e.g. Find Players
posts), reuse `findBannedWord` + `bannedWords()`, don't reinvent.
