# BreakBPM

**A retro Windows 98-style pool & billiards scorer with live Balls-Per-Minute (BPM) tracking.**

From the opening break to the final 8-ball — log every shot, watch your pace, play with friends via 4-digit code or shareable link, or grind solo practice.

> *"BreakBPM — the score that starts at the break and ends when you win."*

## Current Version: v0.5 (React Edition)

This is a **React + Vite + TypeScript** web app that feels like a genuine 1998 Windows program.

### Key Features
- **Full Windows 98 UI** — Classic gray 3D buttons, navy title bars, inset/outset borders, MS Sans Serif font, teal desktop background.
- **Simplified ball system** — Balls shown as `(1)(3)(8)(2)` text.
- **Smart ball selector** — Only shows legal/available balls based on game rules and team assignment.
- **Ball Return terminal** — Green-on-black readout showing sunk balls in chronological order.
- **8-Ball & 9-Ball support** — Proper win conditions (must clear your group before 8-ball; 9-ball wins on the 9).
- **Team assignment** — Solids vs Stripes for 8-ball games.
- **4-digit share code** — Easy-to-say code + full URL with game state.
- **Live BPM + Timer** — Calculated from actual sunk balls.
- **Multiplayer (async)** — Share the link or code.
- **Practice Mode** — Solo drills.
- **Golden Break, foul detection, undo** — Full action history.

## Licensing & Monetization

BreakBPM is available under **two licensing options**:

### Free / Open Source
- Licensed under the **MIT License**
- Free for personal use, open source projects, and non-commercial use
- Must include attribution

### Commercial / Paid
- **Day Pass**: $1.99
- **Annual Pass**: $12.99
- **Lifetime Pass**: $24.99

Paid users receive a **Commercial License** that removes MIT obligations and allows use in closed-source or commercial products.

See [LICENSE](LICENSE) for full details.

## How to Run

Just open `index.html` in any modern browser, or run the React dev server with `pnpm dev`.

## Project Files

- `index.html` / React app
- `README.md` — You're here
- `SCHEMA.md` — Data model
- `CONTRIBUTING.md` — Development guidelines
- `CHANGELOG.md` — Version history
- `LICENSE` — MIT + Commercial options

## Credits

Built with Grok (xAI) + connected GitHub tools.
Original idea by @ThatOtherZach (Zachary Jordan).

*Let's keep the BreakBPM high.* 🎱