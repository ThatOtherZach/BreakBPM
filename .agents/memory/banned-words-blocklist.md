---
name: Banned-words blocklist matching
description: BREAKBPM_BANNED_WORDS filter — letter-boundary matching, player-name sanitizer, and the clean-vs-reject behaviour per surface.
---

`BREAKBPM_BANNED_WORDS` is an owner-curated, comma-separated env list filtering
user-supplied free text. Pure matcher lives in `wordFilter.ts` (server) with a
client mirror in `artifacts/breakbpm/src/lib/wordFilter.ts`.

**Matching uses LETTER boundaries (not whole-word, not substring).** A banned
word matches unless a LETTER sits directly on either side. So digit/symbol-
wrapped uses ("45ass56", "ass!!") ARE caught, but real words ("passes"/
"class"/"grass"/"bass") are NOT.
**Why:** plain substring matching of "ass" would wreck the app's own vocab — it
literally sells "passes". But pure whole-word (digits as boundaries) let users
smuggle slurs as "45slur56". Letter-only boundaries thread both. Cost: misses
letter-glued inflections ("shitty"/"fucker") — owner adds variants explicitly.

**Behaviour per surface (user-directed):**
- HUD ad copy → CLEANED server-side (emoji-swap, never rejected).
- Custom screen names → REJECTED server-side ("choose another name"): they
  double as the public `/watch/{name}` URL handle (`[A-Za-z0-9_-]`), no emoji.
- In-game player names → SANITIZED client-side (`sanitizePlayerName`), at the
  SetupScreen input (on blur + a safety pass in handleStart). On top of the
  banned-word emoji-swap it strips invisible/control/bidi chars, emoji-swaps
  URL/markup runs ("no funny business"), and caps at 125 code points
  (MAX_PLAYER_NAME_LENGTH). Only the free-typed slot; slot-0/@mention names are
  canonical screen names already filtered server-side.

**Why player-name cleaning is client-side at the input (not server-side):**
the random swap picks a different emoji each call, and a player name is copied
into every shot-log entry (keyed by name for per-player BPM). Cleaning the same
name independently in two places would emit two different emoji and break that
match. The only consistent place is the single source — the input — before the
name flows into game state. The list reaches the client via `GET /config`
(`bannedWords`), so the client mirror MUST stay in lockstep with the server
matcher (same regex + emoji set).

**How to apply:** new free-text surfaces — pick clean vs reject by whether the
field is display text (clean) or a constrained handle (reject); if cleaning a
value that propagates by name, clean once at the source, never re-clean
downstream.
