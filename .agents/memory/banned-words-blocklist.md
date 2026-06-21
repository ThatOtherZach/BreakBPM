---
name: Banned-words blocklist matching
description: BREAKBPM_BANNED_WORDS filter — length-tiered + concatenation matching, player-name sanitizer, and the clean-vs-reject behaviour per surface.
---

`BREAKBPM_BANNED_WORDS` is an owner-curated, comma-separated env list filtering
user-supplied free text. Pure matcher lives in `wordFilter.ts` (server) with a
client mirror in `artifacts/breakbpm/src/lib/wordFilter.ts`. Both implement an
identical span-collector (`findBannedSpans`) — keep in lockstep.

**Matching is LENGTH-TIERED + a concatenation rule (not uniform).** Three rules:
1. SHORT entries (≤3 chars: ass/jew/sex/gay) match only at LETTER boundaries
   ("ass"/"45ass56"/"ass!!" caught; "passes"/"class"/"jewelry"/"Sussex"/"bass"
   spared). 3-letter fragments are too common inside real words to substring.
2. LONG entries (≥4 chars: cunt/fuck/pussy) match ANYWHERE (substring), so a
   banned word glued to other text ("cuntycounty", "fuckyou") is caught.
3. A whole letter-run tiled ENTIRELY by banned words ("pussyass"=pussy+ass,
   "assgay"=ass+gay) is swapped wholesale — catches concatenations while sparing
   "assassin"/"bassist" (leftover letters → not fully composed). DP requires ≥2
   segments so it never double-handles a standalone word (rules 1/2 own those).
**Why length-tiered:** earlier pure letter-boundary missed glued evasions
("pussyass", "cuntycounty"); pure substring would wreck the app's own vocab (it
sells "passes", contains "jewelry"). The 4-char cutoff threads both: a 4+ char
slur rarely sits inside an innocent word; a 3-char one usually does.
**Trade-off (documented, accepted):** a LONG entry also flags real words that
contain it — banning `cock` would emoji-swap "cocktail"/"peacock", `cunt` swaps
"Scunthorpe". Tune the list; if a real-word collision bites, the fix is a
curated allowlist (not yet built — add only if needed). Still misses letter-
glued inflections of SHORT words ("shitty") — owner adds variants explicitly.
**Output:** `cleanBannedWords` merges overlapping/abutting spans into ONE emoji
(so "pussyass" → a single emoji, not two).

**Behaviour per surface (user-directed):**
- HUD ad copy → CLEANED server-side (emoji-swap, never rejected).
- Custom screen names → REJECTED server-side ("choose another name"): they
  double as the public `/watch/{name}` URL handle (`[A-Za-z0-9_-]`), no emoji.
- In-game player names → SANITIZED client-side (`sanitizePlayerName`), at the
  SetupScreen input (on blur + a safety pass in handleStart). On top of the
  banned-word emoji-swap it strips invisible/control/bidi chars, emoji-swaps
  URL/markup runs ("no funny business"), and caps at 35 code points
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
