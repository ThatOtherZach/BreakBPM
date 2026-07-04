# Contributing to BreakBPM

Thank you for your interest in BreakBPM! This is a retro Windows 98-style pool scorer built as a React + Vite + TypeScript pnpm monorepo.

## Development Guidelines

### Core Principles

- **Maintain the Windows 98 aesthetic** — Every UI element uses the 98.css box-shadow depth system. Gray 3D buttons, navy title bars, sunken inputs, MS Sans Serif font. Do not modernize the UI.
- **Pure box-shadow buttons** — No CSS `border` on `.btn`. All depth comes from layered `inset` shadows matching the 98.css spec. See the "Button States" section below.
- **Game rules live in `gameLogic.ts`** — Do not duplicate rule logic in components. All win condition checks, legal-ball filtering, and action processing belong in `src/lib/gameLogic.ts`. The server's `stats.ts` deliberately mirrors the BPM/accuracy math from this file (the two artifacts can't import each other) — keep them in lockstep if scoring rules change.
- **Contract-first API** — The API contract lives in `lib/api-spec/openapi.yaml`. Run `pnpm --filter @workspace/api-spec run codegen` after any spec change to regenerate the server Zod schemas and client React Query hooks. Never hand-write API types.
- **Ball colors live in `BALL_COLORS`** — The color map for each ball number is in `GameScreen.tsx`. Keep it in sync with real pool ball colors.
- **Mobile-first** — The app is optimised for narrow phone screens. Test at mobile width first.

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
4. Test thoroughly at mobile width:
   - New game flow (8-ball, 9-ball, practice, Shark, Chaos/No-Rules)
   - Team assignment (auto + manual with per-player dropdowns)
   - Ball selector — only legal balls should appear
   - BPM and timer (pause in practice, auto-runs in game modes)
   - Share code — state must survive a full page reload; join/spectate work
   - Win conditions (8-ball group clearance, Golden Break, Foul-on-8, 9-ball)
   - Undo functionality; Rematch from the win screen reuses mode/players/settings
   - Stats page + leaderboard render for each tier (anonymous, signed-in, pass holder)
   - OBS overlay (`/watch/:name?obs=1`) renders chrome-free and stays live
   - Redeem a code (incl. the Lucky Break "rolling the rack" reveal) and `/redeem/:code` links
   - Find Players post + venue map + nearest-hall compass
   - About page — markdown renders, scrollbar themed
5. Run `pnpm run typecheck` (the canonical check) before delivering.
6. Update `CHANGELOG.md` when adding features.

### Testing Checklist

- [ ] Game starts with a 5-character share code visible
- [ ] Joining an open seat works before the break; spectating by name works
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
- [ ] Stats page loads and respects tier gating (window/scope locks)
- [ ] About page loads, markdown renders, Win98 scrollbar visible

## For Future AIs / Developers

The project has gone through major evolutions:

1. Modern Tailwind pool-hall theme (single `index.html`)
2. Added team assignment + ball selector
3. Added short share codes + proper win rules
4. Full Windows 98 retro theme (still `index.html`)
5. React + Vite + TypeScript monorepo migration
6. Accounts, game history, passes, per-player BPM
7. Statistics page, live join & spectate, recurring subscriptions (v0.7)
8. Tiered entitlements + admin code minting, Lucky Break provably-fair roll, redeem share links, crypto + Stripe checkout (flag-gated), CAD sales ledger
9. Find Players + venue map, OBS overlay, @mention invites, Rematch, Chaos mode + rainbow flourish, leaderboard, public profiles, delete-my-data (v0.9)
10. **Local & city leaderboards, flexible crypto day-pass pricing, 30 Day card pass, invite trials, hall SEO prerender, profile themes — current state (v0.10)**

**Key things to know:**

- `gameLogic.ts` is the source of truth for all rules. Read it before touching any game behavior. The server's `stats.ts` mirrors its BPM/accuracy math — keep them in lockstep.
- The CSS design system is entirely in `index.css` — variables, button states, inputs, scrollbars, layout.
- The `AboutScreen` renders `src/ABOUT.md`, which is bundled at build time (imported as `?raw`) — edit that file to change About-page copy.
- The API is contract-first: edit `lib/api-spec/openapi.yaml`, then run `pnpm --filter @workspace/api-spec run codegen`. Never hand-write API types.
- Access control is tier-based. `entitlement.ts` resolves a caller into `public` / `account` / `pass`. Gate "paid host" features on `tier === 'pass'`, and Lifetime-only perks on the entitlement (`entitlement.isAdmin || entitlement.activePass?.isLifetime`), never on raw passes. See [PERMISSIONS.md](./PERMISSIONS.md) for the full feature-access model.
- No background timers touch the DB. The Postgres instance auto-suspends when idle, so stale in-progress games are finalized **lazily** on the next read/write (or when a spectator views the specific game) — there is no heartbeat/cron sweep. Don't add fixed-interval DB polling.
- Icons live in `public/` and are referenced as `/icon-name.png`.
- See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for system design and [docs/GOTCHAS.md](./docs/GOTCHAS.md) for common footguns.
- The `pnpm-workspace` skill in `.local/skills/` describes the full monorepo structure and TypeScript setup.

If you're an AI continuing this project:

- Maintain the 98.css box-shadow button system — never regress to borders or `outline` hacks.
- Keep `gameLogic.ts` as the single source of truth for rules.
- Always update `CHANGELOG.md` with clear, user-facing entries.
- Run `pnpm run typecheck` and test at mobile width before delivering.

## Questions?

Open an issue or contact [@ThatOtherZach](https://github.com/ThatOtherZach).

*Let's keep the BreakBPM high.* 🎱
