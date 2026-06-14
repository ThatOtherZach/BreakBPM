# Changelog

All notable changes to BreakBPM will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-06-14

### Added
- **Find Players & venue map** — signed-in users can post that they're looking to play, with a scheduled time and location, shown to others on a map and list. A curated billiards-venue map (verified pins geocoded server-side from each venue's address) and a nearest-hall compass help you find a table. Precise meetup coordinates are entitlement-gated: exact location for the post's owner and paid users, a coarse locality label for everyone else.
- **OBS streaming overlay** — append `?obs=1` to any `/watch/:name` link for a chrome-free, transparent live HUD designed for OBS Browser Sources, with optional `&log=1` shot log and `&scale=<n>` sizing. Collapses to a themed `:(` face whenever there's nothing live to show.
- **@Mention to link players** — a paid host can type `@username` into another player's slot to link a registered friend without a join code. The friend gets an opt-in invite on their account after the game finishes: Accept to count it toward their stats/history, or Delete to ignore it.
- **Lucky Break (provably-fair roll)** — a $4.99 "roll the rack" unlock sold via redeem code. Every roll is a guaranteed win — at minimum a 30-day Monthly Pass, with a disclosed chance (default 20%, server-configurable) of a Lifetime Pass. Redeeming plays a retro "rolling the rack" reveal. The seeded draw is selected (not biased) by global shot activity, so the odds never move based on how anyone plays.
- **Crypto checkout** — pay by cryptocurrency (Base USDC / native ETH) for one-time passes and Lucky Break. Built and gated behind an env flag (currently off).
- **Rematch** — the end-of-game screen offers a one-tap Rematch that immediately starts a fresh game reusing the same mode/players/settings with a new share code, skipping setup.
- **Chaos ("No Rules") mode** — a free-for-all variant with no rule enforcement. Win one within your last 10 completed games and your AVG-BPM number animates through a rainbow on your stats page and public profile.
- **Global leaderboard** — ranks players by pace.
- **Public player profiles** — `/watch/:name` shows a player's stats hero and recent history.
- **Redeem share links** — any redeem code can be shared as a QR-friendly `/redeem/:code` link that stashes the code (surviving the sign-up/sign-in redirect) and auto-applies it once signed in.
- **Delete my data** — remove a game from your history: fully deleted if you were the only registered player, otherwise your name is anonymized so other players keep their record.
- **Admin tools** — allowlisted admins (via `BREAKBPM_ADMIN_EMAILS`) can mint pass-granting redeem codes (pick the tier and a max-uses cap or unlimited), manage venues, and view a CAD sales report. Admins are treated as Lifetime-pass holders for every Lifetime perk.
- **Legal pages** — added in-app Terms of Service and Data Policy alongside the existing Subscription & Billing Terms and Cancellation & Refund Policy.
- **PERMISSIONS.md** — a repo-root reference documenting the full tier / entitlement / feature-access model.

### Changed
- **Pricing** — Yearly subscription lowered to $14.99/yr (from $24.99), and Lifetime lowered to $24.99 (from $49.99). Day ($1.99) and Monthly ($4.99/mo) unchanged.
- **Redeem codes are now the active paid path** (Lucky Break codes plus admin-minted comp codes). Card checkout via Stripe is fully built but gated behind the `BREAKBPM_CARD_PAYMENTS_ENABLED` env flag and currently off; subscription *cancellation* always stays available.
- **Sales ledger reports CAD** — every completed sale freezes a USD→CAD conversion (Bank of Canada rate) at sale time for Canadian tax reporting, while all pricing remains USD.

## [0.7.0] - 2026-06-03

### Added
- **Statistics page** — a dedicated `/stats` view with results, accuracy, pace, and ball/pattern breakdowns, styled in the retro CRT/PC-98 aesthetic. Access is tiered: anonymous players see a global 24h snapshot, signed-in players see personal 24h stats, and pass/subscription holders unlock selectable windows (24h / 30d / 365d / all), a personal-vs-global toggle, and live refresh.
- **Join an open seat** — others can join a live game with the 5-character share code before the break. Joiners (guests included) get a view-only mirror of the host's HUD, shot log, and BPM, and can leave/forfeit at any time. The host's device remains the canonical scorekeeper.
- **Spectate by name** — follow a player's live game at `/watch/:name` without needing a code. Spectating is available when the watched player (the host) has a paid plan.
- **Recurring subscriptions** — Monthly ($4.99/mo) and Yearly ($24.99/yr) auto-renewing plans alongside the one-time Day and Lifetime passes. Cancel anytime from the account page; access continues through the paid period. Buying Lifetime stops any active subscription from renewing.
- **Undo tracking** — per-game undo counts are recorded and surfaced in stats.
- **Legal pages** — in-app Subscription & Billing Terms and Cancellation & Refund Policy.

### Changed
- **Pricing ladder** — Day $1.99 (unchanged), new Monthly $4.99/mo, Yearly is now a $24.99/yr subscription (replacing the old $12.99 annual pass), Lifetime raised to $49.99.
- **Three-tier entitlement model** — access now resolves to `public` / `account` / `pass`, drawn from both one-time passes and recurring subscriptions.

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

[0.9.0]: https://github.com/ThatOtherZach/BreakBPM/compare/v0.7.0...v0.9.0
[0.7.0]: https://github.com/ThatOtherZach/BreakBPM/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/ThatOtherZach/BreakBPM/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/ThatOtherZach/BreakBPM/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/ThatOtherZach/BreakBPM/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ThatOtherZach/BreakBPM/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ThatOtherZach/BreakBPM/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ThatOtherZach/BreakBPM/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ThatOtherZach/BreakBPM/releases/tag/v0.1.0
