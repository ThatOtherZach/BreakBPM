---
name: GameState rehydration paths must all preserve new fields
description: Adding a field to breakbpm GameState requires updating every rehydration path or it silently drops (e.g. rematch losing @mentions).
---

# GameState rehydration paths

A new field on `GameState` (artifacts/breakbpm/src/lib/gameLogic.ts) must be
threaded through EVERY place a GameState is (re)constructed, or it silently
vanishes on some code path:

1. `createInitialGameState` (App.tsx) — fresh game / rematch.
2. `encodeGameState` / `decodeGameState` (gameLogic.ts) — legacy `?state=` share links.
3. App's legacy `?state=` restore object (App.tsx `loadStateFromUrl` branch) —
   rebuilds a GameState field-by-field; easy to forget the new key.
4. `SetupScreen.handleResume()` — rebuilds `rehydrated: GameState` from the
   server in-progress snapshot; also field-by-field.
5. localStorage in-progress persistence uses full `JSON.stringify` of the
   state, so it preserves everything automatically (the one path you DON'T
   have to touch).

**Why:** Rematch reads `state.mentions` off the live GameState. If a game was
resumed (server snapshot) or restored (`?state=`), a field omitted from those
rebuild objects is `undefined`, so the feature (e.g. re-inviting @mentioned
players on rematch) silently breaks only on those paths.

**How to apply:** When adding a GameState field, grep for the four rebuild
sites above and add the key to each. `breakerIndex` had the same latent gap.
