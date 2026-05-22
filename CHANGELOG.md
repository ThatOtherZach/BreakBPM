# Changelog

All notable changes to BreakBPM will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-05-22

### Added
- **Per-player BPM in shot log** — every pocketing entry (sink, win, lose-with-ball) is stamped with the shooter's BPM at that moment. Miss, foul, safety, and Shark steal entries are left unstamped. Lets you trace pace shot by shot.
- **Player 1 name lock** — when signed in, the Player 1 name field is pre-filled with the account's screen name and made read-only across all game modes (8-ball 1–4P, Shark, 9-ball, Practice). Prevents stat pollution. Slots 2–4 remain editable.
- **Improved HUD sublabel** — replaced the table-wide "X SUNK" label under the hero BPM with a per-shooter remaining-balls readout:
  - 8-ball (teams assigned, including Shark): "N SOLIDS LEFT" / "N STRIPES LEFT" — count includes both the shooter's group balls *and* the 8-ball so the number reflects everything they still need to pocket.
  - Once the shooter's group is fully cleared: "8-BALL TO WIN".
  - 8-ball pre-assignment, 9-ball, Practice: "N BALLS LEFT" (table total).

### Fixed
- HUD sublabel was showing a table-wide sunk count next to a per-player BPM figure, making BPM look like a team or table stat rather than an individual one.
- 8-ball/Shark remaining count now correctly includes the 8-ball so the readout never undercounts by 1 mid-game.

## [0.5.1] - 2026-05-21

### Added
- **User accounts** — Clerk authentication: sign-in, sign-up, screen name, email.
- **Game persistence** — in-progress games synced to server; cross-device resume prompt on the Setup screen.
- **Game history** — saved per-account; visible in Account screen. Free users see a limited window; pass holders see full history.
- **Passes & checkout** — Day ($1.99), Annual ($12.99), Lifetime ($24.99) passes via Stripe or redemption code.
- **Account screen** — profile management, pass status, purchase / redeem flow, history log.
- **Auto-forfeit sweep** — server-side inactivity detection via `/games/activity` heartbeat.

## [0.5.0] - 2026-05-15

Major rewrite migrating from a single `index.html` file to a full React + Vite + TypeScript pnpm monorepo. Complete Win98 UI overhaul using the 98.css box-shadow specification.

### Added
- React + Vite + TypeScript project scaffolding (pnpm monorepo)
- Navbar component — 8-ball icon + "BreakBPM" branding left, hamburger right
- Hamburger menu reveals a Win98 horizontal menu bar with "About" link
- About page — splash banner + live README.md fetch rendered as markdown
- Win98 scrollbar on About page (SVG arrow buttons, beveled thumb, checkered track)
- Custom action button icons: miss, foul, safety, undo, history, end-game, reset, copy
- Colored ball indicators — each ball rendered in correct pool color
- Golden Break rule — sinking the 8 on the break is an instant win
- Foul-on-8 detection — fouling while sinking the 8 is an instant loss
- Team assignment checkbox — "Automatic team assignment" checked by default; uncheck to assign per player inline
- Per-player team dropdowns inline with name row when manual assignment is on
- Win98 checkbox component (sunken white square, SVG checkmark)

### Changed
- **Buttons**: Migrated to pure box-shadow depth (no CSS border) matching 98.css specification
  - Normal: `inset -1px -1px #0a0a0a, inset 1px 1px #fff, inset -2px -2px grey, inset 2px 2px #dfdfdf`
  - Default/primary: extra outer shadow layer instead of `outline` ring
  - Pressed: inverted shadow + `text-shadow: 1px 1px #222`
- **Selected toggle buttons** (game type, player count): light blue fill + sunken pressed shadow — consistent across all selector rows
- **Inputs**: Migrated to 98.css sunken-well shadow (`inset 2px 2px #0a0a0a` inner dark corner)
- **Radio buttons** replaced with a single checkbox for team assignment
- Team assignment placeholder changed from "Team?" to "-Select-"
- Tagline updated to "Play fast, track stats"
- `btn-primary` no longer uses `outline` hack — uses the Win98 "default button" thick shadow
- Game type and player count selected states use the same `.selected` style (pressed shadow + `#e0e8ff` background)

### Fixed
- 8-ball: `getLegalBalls` now always includes the 8-ball until it has been sunk
- 8-ball: Golden Break correctly detected when 8 is sunk with no prior balls sunk
- 8-ball: Foul-on-8 (group cleared + foul = instant loss) properly handled in `turnAction`
- About page scroll fixed with `overflow: hidden` on container + `overflow-y: scroll` on inner scroll area
- Black outline ring removed from highlighted buttons ("Start Game", "2P", "Resume")

## [0.4.0] - 2026-05-14
### Added
- Full Windows 98 retro UI theme (gray 3D windows, navy title bars, classic fonts)
- Simplified ball system using `(X)` text notation only
- Smart ball selector showing only legal/available balls
- Green terminal-style ball return readout showing sunk balls in order
- Major UI overhaul while keeping all core functionality

### Changed
- Ball representation changed from emojis/colors to simple `(1)(3)(8)` format
- Ball return moved to prominent terminal-style input field

## [0.3.0] - 2026-05-14
### Added
- Prominent Ball Return visual (L-inspired design)
- Balls append in chronological order with roll-in animation
- Improved player scores section

## [0.2.0] - 2026-05-14
### Added
- Team assignment (Solids vs Stripes) for 8-ball
- Ball selector modal with legal balls only
- 4-digit short code generator + improved sharing
- Proper 8-ball and 9-ball win rules (group clearance before 8-ball)

## [0.1.0] - 2026-05-14
### Added
- Initial release
- Basic scoring, BPM tracking, timer, shareable URL state
- 8-ball / 9-ball / practice modes
- Multiplayer via link (async state sharing)
- Shot logging and undo

[0.6.0]: https://github.com/ThatOtherZach/BreakBPM/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/ThatOtherZach/BreakBPM/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/ThatOtherZach/BreakBPM/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ThatOtherZach/BreakBPM/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ThatOtherZach/BreakBPM/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ThatOtherZach/BreakBPM/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ThatOtherZach/BreakBPM/releases/tag/v0.1.0
