---
name: History-card host-theme snapshot
description: Completed-game history-card felt color is the host's theme FROZEN onto the game at play time — and the invariant that protects it from client gameState writes.
---

# History-card host-theme snapshot

The pool-felt tint on a **completed** game's history card (account history, watch
profile, mention invites) is the host's theme **as it was at play time**, frozen
onto the game — NOT resolved live from the host's current profile. No theme / a
legacy pre-snapshot game → default green. (Live `/games/state` host theme is
intentionally still live; only finished-game history is historical.)

**Why:** the requirement is explicitly historical — the card must show the felt
the host played with then, even if they later change or clear their theme.

## Invariant: client gameState writes must preserve server snapshot keys

The frozen theme lives **inside the same `gameState` JSON blob the client owns**.
Any route that persists client-supplied `gameState` (resume snapshot, finalize,
and any future one) will silently erase server-authoritative keys unless it
strips the client copy and re-applies the server value. Treat `gameState` as a
mixed blob: client-owned fields + server-snapshot keys.

**How to apply:** before persisting a client `gameState`, re-merge the existing
server snapshot keys (today: the host theme). A no-id insert path that bypasses
game-start must resolve the value the same way start does. The delete-my-data
anonymizer mutates the existing blob in place, so it's already safe.

Regression coverage: `artifacts/api-server/src/routes/games-history-theme.test.ts`
(drives the real routes end-to-end, incl. the client-injection-is-ignored case).
