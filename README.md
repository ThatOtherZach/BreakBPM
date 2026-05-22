# BreakBPM

**A retro Windows 98-style pool & billiards scorer with live per-player Balls-Per-Minute (BPM) tracking.**

From the opening break to the final 8-ball — log every shot, watch your pace, resume across devices, and play with friends via 4-digit code or shareable link. Or grind solo with **Shark Mode** — the ultimate solo 8-ball challenge where an invisible predator steals balls on your mistakes.

> *"BreakBPM — the score that starts at the break and ends when you win."*

**Copyright © 2026 Zachary Jordan. I am the sole copyright holder of BreakBPM. All rights not explicitly granted under the AGPL-3.0 are reserved.**

## Current Version: v0.6 (Accounts + Per-Player BPM)

A fully functional **React + Vite + TypeScript** web app styled like genuine 1998 Windows software. Built mobile-first (optimized for 412px width) with a complete Windows 98 design system, user accounts, game history, and passes.

### Key Features

**UI & Experience**
- Authentic Windows 98 aesthetic (3D buttons, sunken inputs, beveled panels, MS Sans Serif font, custom scrollbars)
- Green CRT terminal-style game area
- Clean, satisfying retro interface

**Game Modes**
- **8-Ball**: Full rules with Solids vs Stripes, Golden Break, foul-on-8 loss, up to 4 players
- **9-Ball**: Lowest ball first, sink the 9 to win
- **Shark Mode** 🦈: Solo 8-ball vs the invisible Shark. Miss (or foul on Hard) and it steals a random ball. Normal vs Hard aggression toggle.
- **Practice Mode**: Solo drills with no win conditions

**Gameplay**
- Up to 4 players with automatic or manual team assignment (solids/stripes)
- Smart ball selector — only shows legal/available balls
- Live per-player BPM + timer (anchored to each player's first pocket)
- HUD sublabel shows remaining balls for the current shooter's group (including the 8), or "8-BALL TO WIN" once their group is cleared
- Per-shot BPM stamped on every pocketing entry in the shot log
- Foul detection, undo, shot history
- Win screen with final stats

**Accounts & Persistence**
- Sign in with Clerk — screen name, email, profile management
- Player 1 name auto-filled from your account and locked (all game modes) to keep BPM history accurate
- In-progress games synced to the server — resume on a different device
- Full game history saved per account (limited for free users)
- Day Pass ($1.99), Annual ($12.99), Lifetime ($24.99) — redeemable via code or Stripe checkout

**Sharing**
- 4-digit share code (easy to read out loud)
- Full game state encoded in URL for instant multiplayer

## How to Run

```bash
pnpm install
pnpm --filter @workspace/breakbpm run dev   # frontend (reads PORT env)
pnpm --filter @workspace/api-server run dev # backend (port 8080)
```

Required env: `DATABASE_URL` (Postgres), `VITE_CLERK_PUBLISHABLE_KEY`.

## Project Structure

```
artifacts/
  breakbpm/src/
    App.tsx                 App shell — routing, game persistence, auth gating
    lib/gameLogic.ts        Core rules, BPM calculation (pure TypeScript)
    lib/authClient.tsx      Clerk seam — useAuth(), AuthProvider
    components/
      SetupScreen.tsx       Game setup — mode, players, name lock for signed-in users
      GameScreen.tsx        Active HUD — shot log, per-player BPM, ball selector
      AccountScreen.tsx     Profile, pass status, game history
  api-server/src/
    routes/                 games.ts, auth.ts, passes.ts
lib/
  db/src/schema/            Drizzle schema (users, games, passes, discountCodes)
  api-spec/openapi.yaml     OpenAPI 3.1 contract (source of truth)
  api-zod/ api-client-react/  Generated types + React Query hooks
```

## License

BreakBPM is open-source software licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

This license ensures full transparency: the source code is public, and anyone who modifies and runs it as a network service must make their modifications available under the same license.

**Commercial / Closed-Source Use**
If you want to use BreakBPM (or a modified version) in a commercial product **without** the AGPL copyleft obligations, paid commercial licenses are available:

- Day Pass: $1.99
- Annual Pass: $12.99
- Lifetime Pass: $24.99

See the [LICENSE](./LICENSE) file or contact me directly (@ThatOtherZach on GitHub or X) for details.

## Credits

Built with Grok (xAI), Claude (Anthropic), and Replit Agent.
Original idea by [@ThatOtherZach](https://x.com/ThatOtherZach)

*Let's keep the BreakBPM high.* 🎱
