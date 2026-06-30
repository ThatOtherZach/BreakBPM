---
name: Public profile guest-name redaction
description: Redacting names on the public /watch profile must close second-hop recovery and trust server identity records, not client gameState.
---

# Public profile guest-name redaction

When hiding free-text names on the PUBLIC `/games/profile` (`/watch/{name}`)
Recent Games, redacting the obvious fields is not enough. Two non-obvious
requirements:

1. **Close the share-code second hop.** `GET /games/state` is public-by-code and
   returns an ENDED game's FULL `gameState` (typed guest names, shot log) plus
   participant displayNames to ANYONE — the `ended` flag does not gate the body.
   So leaving `shareCode` in the profile response makes the profile a directory
   for recovering the very names you just redacted. `toHistoryEntry` omits
   `shareCode` on the redacted path (`GameHistoryEntry.shareCode` is optional, so
   omission — not `null` — is contract-valid; `null` fails the response Zod).

2. **Source the displayed registered-opponent name from a SERVER identity
   record, not gameState.** The opponent string resolved from `gameState`/summary
   is client-controlled (a host bulk-writes it every activity/save and could
   tamper a registered slot's label). `fetchRegisteredSlots` returns
   `Map<gameId, Map<slot, canonicalName>>` keyed by server-set
   `game_participants.displayName` (= `user.screenName` on start/join) and
   `game_mentions.displayName` (notNull). The public path shows that canonical
   label; everything else (guests, team strings with no single slot) → null.

**Why:** threat_model.md treats `gameState` as attacker-controlled and requires
the public profile not to over-disclose. The `@link` feature already assumes a
registered opponent's shown name == their screenName, so canonical sourcing is
also the correct (not just safer) value.

**How to apply:** keep redaction gated behind `redactGuestNames` (true ONLY at
the `/games/profile` call site; `/games/history` + invites pass false). Any new
public surface that echoes a name or a share code must apply BOTH rules. Tests:
`artifacts/api-server/src/routes/games-profile.test.ts` asserts the serialized
body contains no guest string and that a spoofed registered-slot gameState name
is overridden by the canonical one.
