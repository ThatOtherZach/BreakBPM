# BreakBPM

**A retro Windows 98-style pool & billiards scorer with live Balls-Per-Minute (BPM) tracking.**

From the opening break to the final 8-ball — log every shot, watch your pace, play with friends via 4-digit code or shareable link, or grind solo practice.

> *"Play fast, track stats."*

## Current Version: v0.5 (React Edition)

BreakBPM is a **mobile-first React + Vite web app** (optimised for 412px) built with a genuine Windows 98 aesthetic. Every button, input, and scrollbar is hand-crafted to match the 98.css spec.

### Key Features

- **Full Windows 98 UI** — Pure box-shadow 3D buttons (no borders), sunken inputs, beveled panels, MS Sans Serif font, and Win98 scrollbars throughout.
- **Navbar** — 8-ball icon + BreakBPM branding left; hamburger right reveals a Win98 menu bar with an About link.
- **About page** — Splash banner + live README fetch rendered as markdown, with a themed Win98 scrollbar.
- **Game modes** — 8-Ball (Solids vs Stripes), 9-Ball (sink the 9 to win), Practice (solo drills, no win conditions).
- **Up to 4 players** — Names, live scores, and per-player BPM.
- **Live BPM + Timer** — Calculated from actual sunk balls over game duration. Pauses in practice mode.
- **Smart ball selector** — Only shows legal/available balls based on game rules, team assignment, and balls already sunk.
- **Colored ball indicators** — Each ball rendered in its correct pool color.
- **8-Ball rules** — Full group-clearance rule, Golden Break (8 on break = instant win), Foul-on-8 detection (instant loss).
- **9-Ball rules** — Must contact lowest ball first; sinking the 9 wins.
- **Team assignment** — Checkbox for automatic (first ball sunk decides) or manual per-player team selection inline with the name row.
- **Custom action icons** — Miss, Foul, Safety, Undo, Shot History, End Game, Reset, Copy (share code).
- **4-digit share code** — Easy-to-say code (e.g. `K7P2`) + full URL with encoded game state.
- **Shot log** — Full action history with undo.
- **Pause / Reset** — Available in practice mode.
- **Win screen** — Shows winner, BPM, and game stats.

## Stack

- pnpm workspaces monorepo, Node.js 24, TypeScript 5.9
- **Frontend**: React 18 + Vite, vanilla CSS (Win98 custom design system)
- **Game logic**: Pure TypeScript (`gameLogic.ts`)
- **Markdown rendering**: `marked`
- **Styling reference**: [98.css](https://jdan.github.io/98.css/) (box-shadow patterns, scrollbar SVGs)

## How to Run

```bash
# Install dependencies
pnpm install

# Start the dev server
pnpm --filter @workspace/breakbpm run dev
```

Then open the preview at the port shown in your terminal (or via the Replit preview pane).

## Project Structure

```
artifacts/breakbpm/
├── public/                 # Static icons (miss, foul, safety, undo, etc.)
├── src/
│   ├── components/
│   │   ├── Navbar.tsx          # Top bar + hamburger menu
│   │   ├── SetupScreen.tsx     # Game setup UI
│   │   ├── GameScreen.tsx      # Active game UI + ball selector
│   │   └── AboutScreen.tsx     # About page with README fetch
│   ├── lib/
│   │   └── gameLogic.ts        # All game rules, state, win conditions
│   ├── App.tsx                 # View routing (setup / game / about)
│   └── index.css               # Full Win98 design system (vars, buttons, inputs, etc.)
```

## Data Model

- **Players**: `id`, `name`, `team` (solids/stripes), runtime stats (balls sunk, BPM)
- **GameState**: type, players, sunkBalls, currentPlayer, actions[], shareCode, timestamps
- **Actions**: Every pot, miss, foul, safety, win — timestamped for accurate BPM

Game state is encoded into the URL (`?state=…`) for sharing. Designed to be backend-ready with zero schema changes.

## Vision & Goals

- Make casual pool nights more fun and trackable
- Bring back that satisfying 90s software feel
- Keep the core loop dead simple: Start → Assign teams → Sink balls → Watch BPM climb → Win
- Future: real-time multiplayer rooms, player accounts, advanced stats, payment integration

## Roadmap

- [ ] Real-time multiplayer (WebSocket or Firebase rooms)
- [ ] Player accounts & persistent history
- [ ] Payment integration (Stripe per-game credits)
- [ ] Sound effects (classic Windows .wav style)
- [ ] Export game summary / share image
- [ ] Animated win screen

## What the Next Developer / AI Should Know

The project has gone through major evolutions:

1. Modern Tailwind pool-hall theme (single HTML file)
2. Added team assignment + ball selector
3. Added 4-digit codes + proper win rules
4. Full Windows 98 retro theme (`index.html` era)
5. **React + Vite + TypeScript monorepo migration** — current state

**Important for future AIs:**
- Read `CONTRIBUTING.md` first for specific constraints
- Maintain the Windows 98 aesthetic — every new UI element should use the same `box-shadow` depth system
- Ball colors live in `BALL_COLORS` in `GameScreen.tsx`
- Game rules live exclusively in `gameLogic.ts` — do not duplicate logic in components
- Update `CHANGELOG.md` with every release

## Credits

Built with Grok (xAI), Claude (Anthropic), and Replit Agent.
Original idea by [@ThatOtherZach](https://github.com/ThatOtherZach) (Zachary Jordan).

*Let's keep the BreakBPM high.* 🎱
