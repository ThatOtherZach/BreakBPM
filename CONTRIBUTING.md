# Contributing to BreakBPM

Thank you for your interest in BreakBPM! This is a retro Windows 98-style pool scorer built as a React + Vite + TypeScript pnpm monorepo.

## Development Guidelines

### Core Principles

- **Maintain the Windows 98 aesthetic** — Every UI element uses the 98.css box-shadow depth system. Gray 3D buttons, navy title bars, sunken inputs, MS Sans Serif font. Do not modernize the UI.
- **Pure box-shadow buttons** — No CSS `border` on `.btn`. All depth comes from layered `inset` shadows matching the 98.css spec. See the "Button States" section below.
- **Game rules live in `gameLogic.ts`** — Do not duplicate rule logic in components. All win condition checks, legal-ball filtering, and action processing belong in `src/lib/gameLogic.ts`.
- **Ball colors live in `BALL_COLORS`** — The color map for each ball number is in `GameScreen.tsx`. Keep it in sync with real pool ball colors.
- **Mobile-first** — The app is optimised for 412px wide screens. Test at that width first.

### Button States (98.css spec)

```css
/* Normal */
box-shadow: inset -1px -1px #0a0a0a, inset 1px 1px #fff, inset -2px -2px grey, inset 2px 2px #dfdfdf;

/* Default / Primary action */
box-shadow: inset -2px -2px #0a0a0a, inset 1px 1px #0a0a0a, inset 2px 2px #fff, inset -3px -3px grey, inset 3px 3px #dfdfdf;

/* Pressed / Active */
box-shadow: inset -1px -1px #fff, inset 1px 1px #0a0a0a, inset -2px -2px #dfdfdf, inset 2px 2px grey;

/* Selected toggle (game type, player count) */
background: #e0e8ff;
box-shadow: inset -1px -1px #fff, inset 1px 1px #0a0a0a, inset -2px -2px #dfdfdf, inset 2px 2px grey;

/* Input / sunken field */
box-shadow: inset -1px -1px #fff, inset 1px 1px grey, inset -2px -2px #dfdfdf, inset 2px 2px #0a0a0a;
```

Never use `outline` to simulate a button border. If you need a "default" button appearance, use the primary box-shadow pattern above.

### How to Make Changes

1. Install dependencies: `pnpm install`
2. Start dev server: `pnpm --filter @workspace/breakbpm run dev`
3. Edit source files in `artifacts/breakbpm/src/`
4. Test thoroughly at 412px width:
   - New game flow (8-ball, 9-ball, practice)
   - Team assignment (auto + manual with per-player dropdowns)
   - Ball selector — only legal balls should appear
   - BPM and timer (pause in practice, auto-runs in game modes)
   - Share code — state must survive a full page reload
   - Win conditions (8-ball group clearance, Golden Break, Foul-on-8, 9-ball)
   - Undo functionality
   - About page — markdown renders, scrollbar themed
5. Update `CHANGELOG.md` when adding features.

### Testing Checklist

- [ ] Game starts with 4-digit share code visible
- [ ] Ball selector only shows legal/available balls for current player
- [ ] Colored ball indicators display correct pool colors
- [ ] BPM and timer run correctly; pause works in practice mode
- [ ] Share URL encodes and restores full game state on reload
- [ ] Win modal appears with correct winner and stats
- [ ] Undo reverses last action correctly
- [ ] Automatic team assignment: first ball sunk assigns the team
- [ ] Manual team assignment: dropdowns appear inline per player
- [ ] Golden Break: sinking the 8 on the break = instant win
- [ ] Foul-on-8: fouling while sinking the 8 = instant loss
- [ ] About page loads, markdown renders, Win98 scrollbar visible

## For Future AIs / Developers

The project has gone through major evolutions:

1. Modern Tailwind pool-hall theme (single `index.html`)
2. Added team assignment + ball selector
3. Added 4-digit codes + proper win rules
4. Full Windows 98 retro theme (still `index.html`)
5. **React + Vite + TypeScript monorepo — current state (v0.5)**

**Key things to know:**

- `gameLogic.ts` is the source of truth for all rules. Read it before touching any game behavior.
- The CSS design system is entirely in `index.css` — variables, button states, inputs, scrollbars, layout.
- The `AboutScreen` fetches `README.md` from the GitHub raw URL — keep that URL valid.
- Icons live in `public/` and are referenced as `/icon-name.png`.
- The `pnpm-workspace` skill in `.local/skills/` describes the full monorepo structure and TypeScript setup.

If you're an AI continuing this project:

- Maintain the 98.css box-shadow button system — never regress to borders or `outline` hacks.
- Keep `gameLogic.ts` as the single source of truth for rules.
- Always update `CHANGELOG.md` with clear, user-facing entries.
- Test at 412px width before delivering.

## Questions?

Open an issue or contact [@ThatOtherZach](https://github.com/ThatOtherZach).

*Let's keep the BreakBPM high.* 🎱
