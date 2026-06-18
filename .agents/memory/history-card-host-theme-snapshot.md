---
name: History-card host-theme snapshot
description: The completed-game history card felt color is the host's theme frozen onto the game at start time, not resolved live — and how client gameState writes must protect it.
---

# History-card host-theme snapshot

The pool-felt tint on a completed game's history card (account history, watch
profile, mention invites — anywhere `toHistoryEntry` renders) is the **host's
theme as it was at play time**, snapshotted onto the game, NOT resolved live from
the host's current profile.

- Snapshot is written at `POST /games/start`: `resolveUserEffectiveTheme(host)` →
  stored as a `hostTheme` string key inside the game's `gameState` JSON. No theme
  → key omitted → history renders default green. Pre-snapshot (legacy) games have
  no key → green.
- `toHistoryEntry` derives the card color from the snapshot
  (`coerceBackgroundVariant(readHostThemeRaw(gs))`), never from a live lookup.
- Live `/games/state` host theme is intentionally LEFT live (only finished-game
  history is historical).

**Why:** the requirement is explicitly historical — a card must show the felt the
host was playing with then, even if they later change or remove their theme.

## The trap: whole-blob gameState writes erase the snapshot

`hostTheme` lives inside the same `gameState` JSON blob the client owns. Two routes
replace that blob wholesale with client-supplied state and will silently clobber
the snapshot unless guarded:

- `/games/activity` (resume snapshot) and `/games/save` (finalize) both persist
  client `gameState`.
- Guard with `withHostThemeSnapshot(clientState, hostTheme)`: it **strips any
  client-supplied `hostTheme`** (clients must never set it) and re-applies the
  server-authoritative value (null → key omitted). Read the existing snapshot off
  the started row with `readHostThemeRaw(gs)` and pass it through.
- `/games/save` with no `gameId` (insert fallback that bypasses `/games/start`)
  must resolve the theme fresh via `resolveUserEffectiveTheme`, same rule as start.
- The delete-my-data anonymizer mutates the existing `gameState` object in place
  and writes it whole, so it already preserves `hostTheme` — safe, leave it.

**How to apply:** any NEW code path that writes a game's `gameState` from
client-supplied data must preserve server-snapshotted keys (today: `hostTheme`).
Treat `gameState` as a mixed blob: client-owned fields + server-authoritative
snapshot keys. Regression coverage lives in
`artifacts/api-server/src/routes/games-history-theme.test.ts` (drives the real
routes end-to-end).
