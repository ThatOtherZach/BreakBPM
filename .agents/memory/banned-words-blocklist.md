---
name: Banned-words blocklist matching
description: BREAKBPM_BANNED_WORDS filter — whole-word matching, and why ads are cleaned while screen names are rejected.
---

`BREAKBPM_BANNED_WORDS` is an owner-curated, comma-separated env list filtering
user-supplied free text. Pure matcher lives in `wordFilter.ts`.

**Matching is WHOLE-WORD, not substring.**
**Why:** this app's own vocabulary collides with naughty substrings — it
literally sells "passes". Substring matching of "ass" would wreck
"passes"/"class"/"grass". Cost: misses inflections ("shitty" when only "shit"
listed) — owner adds variants explicitly.

**Two behaviours by surface, and why they differ:**
- HUD ad copy → CLEANED, never rejected: each blocked word is swapped for a
  random emoji and the copy proceeds. Ad copy is free display text, so a fun
  redaction beats a hard refusal.
- Custom screen names → REJECTED ("choose another name"): they double as the
  public `/watch/{name}` URL handle (`[A-Za-z0-9_-]` only), so emoji can't go
  there. The user explicitly chose reject-only for names over allowing emoji
  handles or a link-safe filler swap.

**How to apply:** for new free-text surfaces, pick the matching behaviour by
whether the field is display text (clean) or a constrained handle (reject);
reuse the existing matcher, don't reinvent.
