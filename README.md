# BreakBPM

**A retro Windows 98-style pool & billiards scorer with live Balls-Per-Minute (BPM) tracking.**

From the opening break to the final 8-ball — log every shot, watch your pace, play with friends via 4-digit code or shareable link, or grind solo practice.

> *"BreakBPM — the score that starts at the break and ends when you win."*

**Copyright © 2026 Zachary Jordan. I am the sole copyright holder of BreakBPM. All rights not explicitly granted under the AGPL-3.0 are reserved.**

## Current Version: v0.5 (React Edition)

A fully functional **React + Vite + TypeScript** web app styled like genuine 1998 Windows software. Built mobile-first (optimized for 412px width) with a complete Windows 98 design system.

### Key Features

**UI & Experience**
- Authentic Windows 98 aesthetic (3D buttons, sunken inputs, beveled panels, MS Sans Serif font, custom scrollbars)
- Green CRT terminal-style game area
- Clean, satisfying retro interface

**Game Modes**
- **8-Ball**: Full rules with Solids vs Stripes, Golden Break, foul-on-8 loss
- **9-Ball**: Lowest ball first, sink the 9 to win
- **Shark Mode**: Solo 8-ball vs the invisible Shark. Miss and it steals a ball (Normal: only on miss | Hard: miss or foul). Sink the 8-ball with >1.0 balls per shot to outswim it. (A "shark" is also what you call a pool player hiding their true skill 🦈)
- **Practice Mode**: Solo drills with no win conditions

**Gameplay**
- Up to 4 players with team assignment (solids/stripes)
- Smart ball selector — only shows legal/available balls
- Live BPM + timer (calculated from actual sunk balls)
- Foul detection, undo, shot history
- Win screen with final stats

**Sharing**
- 4-digit share code (easy to read out loud)
- Full game state encoded in URL for instant multiplayer

**Monetization**
- Free version available
- Paid commercial licenses: Day Pass ($1.99), Annual ($12.99), Lifetime ($24.99)

## How to Run

```bash
pnpm install
pnpm --filter @workspace/breakbpm run dev
```

Or just open `index.html` in any browser for the static preview.

## Project Structure

- `lib/gameLogic.ts` — Core rules, state management, and win conditions (pure TypeScript)
- `components/` — React components (GameScreen, SetupScreen, Navbar, etc.)
- `artifacts/breakbpm/public/` — Game icons and assets

## License

BreakBPM is open-source software licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

This license ensures full transparency: the source code is public, and anyone who modifies and runs it as a network service (web app, hosted tool, etc.) must make their modifications available under the same license.

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