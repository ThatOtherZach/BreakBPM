# BreakBPM

**A retro Windows 98-style pool & billiards scorer with live Balls-Per-Minute (BPM) tracking.**

From the opening break to the final 8-ball — log every shot, watch your pace, play with friends via 4-digit code or shareable link, or grind solo practice.

> *"BreakBPM — the score that starts at the break and ends when you win."*

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

**Dual Licensing:**
- **MIT License** — Free for personal and open source use
- **Commercial License** — Day Pass $1.99 / Annual $12.99 / Lifetime $24.99

See [LICENSE](LICENSE) for full details.

## Credits

Built with Grok (xAI), Claude (Anthropic), and Replit Agent.
Original idea by [@ThatOtherZach](https://x.com/ThatOtherZach)

*Let's keep the BreakBPM high.* 🎱