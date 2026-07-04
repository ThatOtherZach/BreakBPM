# BreakBPM

**A retro Windows 98-style pool & billiards scorer with live per-player Balls-Per-Minute (BPM) tracking.**

From the opening break to the final 8-ball — log every shot, watch your pace, resume across devices, and play with friends via a 5-character share code or shareable link. Track your shooting stats over time, let others join an open seat or spectate live (even as a chrome-free OBS overlay), find players near you, compete on local hall leaderboards, or grind solo with **Shark Mode** — the ultimate solo 8-ball challenge where an invisible predator steals balls on your mistakes.

> *"BreakBPM — the score that starts at the break and ends when you win."*

**Copyright © 2026 Zachary Jordan. I am the sole copyright holder of BreakBPM. All rights not explicitly granted under the AGPL-3.0 are reserved.**

## Current Version: v0.10 (Local Leaderboards, Flexible Passes, SEO & more)

A fully functional **React + Vite + TypeScript** web app styled like genuine 1998 Windows software. Built mobile-first with a complete Windows 98 / PC-98 design system, user accounts, game history, tiered statistics, global/local/city leaderboards, live join & spectate, an OBS streaming overlay, a player-finder with a venue map, flexible pass pricing, and a provably-fair "Lucky Break" unlock.

### Key Features

**UI & Experience**
- Authentic Windows 98 aesthetic (3D buttons, sunken inputs, beveled panels, MS Sans Serif font, custom scrollbars)
- Green CRT terminal-style game area with stats and pocketed balls
- Retro PC-98 console styling throughout, including the statistics page
- Profile themes — earned felt/table styles and admin-minted backgrounds

**Game Modes**
- **8-Ball**: Full rules with Solids vs Stripes, Golden Break, foul-on-8 loss, up to 4 players
- **9-Ball**: Lowest ball first, sink the 9 to win
- **Shark Mode** 🦈: Solo 8-ball vs the invisible Shark. Miss (or foul on Hard) and it steals a ball. Normal vs Hard aggression toggle. Ball removal is honor-system — lift an easy-looking Shark ball off the real table, or shoot one of its balls yourself, then tap it in the selector to keep the on-screen rack in sync.
- **Practice Mode**: Solo drills with no win conditions
- **Chaos ("No Rules") Mode**: A free-for-all variant with no rule enforcement. Win one and your AVG-BPM number earns a cosmetic rainbow flourish on your stats and profile (see Statistics).

**Gameplay**
- Up to 4 players with automatic or manual team assignment (solids/stripes)
- Smart ball selector — only shows legal/available balls
- Live per-player BPM + timer (anchored to each player's first pocket)
- HUD sublabel shows remaining balls for the current shooter's group (including the 8), or "8-BALL TO WIN" once their group is cleared
- Per-shot BPM stamped on every pocketing entry in the shot log
- Foul detection, undo, shot history
- Win screen with final stats and a one-tap **Rematch** that reuses the same mode/players/settings (including @mentioned friends) with a fresh game and share code
- **Remove yourself** from a game you joined — leave or forfeit without affecting the host's session

**Statistics & Leaderboards**
- Dedicated `/stats` page with results, accuracy, pace, and ball/pattern breakdowns
- Tiered access: anonymous players see a global 24h view; signed-in players see personal 24h stats; pass/subscription holders unlock selectable windows (24h / 30d / 365d / all), a personal-vs-global toggle, and live refresh
- Public player profiles (`/watch/:name`) reuse the same stats hero; guest free-text names are redacted
- **Global leaderboard** — composite skill ranking (accuracy-weighted pace; best-2 of ≥2 qualifying 1-on-1 games)
- **Local hall leaderboards** (`/leaderboard/hall/:slug`) — per-venue boards; public 30-day window, pass-gated 90d/all-time
- **City leaderboards** (`/leaderboard/city/:locality`) — rolls up games tagged to a hall or city
- Post-game **hall/city tagging** — hosts tag finished 1-on-1 8/9-ball games while on location
- Dedicated **Shark leaderboard** with win-based ranking
- Recent **Chaos winners** get a cosmetic flourish: win a "No Rules" game within your last 10 completed games and your AVG-BPM number animates through a rainbow

**Multiplayer — one host, many viewers**
- Every game has a 5-character share code; the host's device is the canonical scorekeeper
- **Join** an open seat before the break (view-only, guests welcome, leave/forfeit anytime)
- **Spectate** any live game by player name without a code — a perk available when the host has a paid plan
- **@Mention to link players**: a paid host can type `@username` into another slot to link a registered friend without a join code; the friend gets an opt-in invite on their account after the game (Accept to count it, Delete to ignore)
- **OBS overlay**: append `?obs=1` to a `/watch/:name` link for a chrome-free, transparent live HUD made for OBS Browser Sources (optional `&log=1` shot log and `&scale=<n>` sizing)
- Share a game by its 5-character code, a `/join/:code` link, or a `/watch/:name` link (older `?state=` URL links still open as a lossy fallback for restoration)

**Find Players & Venues**
- **Find Players** lets signed-in pass holders post that they're looking to play, with a scheduled time and location, shown to others on a map and list
- Precise meetup coordinates are entitlement-gated — exact location for the post's owner and paid users, a coarse locality label for everyone else
- A curated **venue map** of billiards halls; verified venue pins are placed from the saved address (geocoded server-side), and a compass points to the nearest hall
- **`/for-venues`** — free verified-hall listing pitch for pool halls (map pin, local leaderboard, website backlink)

**Accounts & Persistence**
- Sign in with Clerk — screen name, email, profile management
- Player 1 name auto-filled from your account and locked (all game modes) to keep BPM history accurate
- In-progress games synced to the server — resume on a different device
- Full game history saved per account (limited for free users)
- **Delete my data**: remove a game from your history — fully deleted if you were the only registered player, otherwise your name is anonymized so other players keep their record
- **Invite links** — share `/invite/:code` so new signups get a free trial pass (default 24 hours)

**Plans**
- **Purchase Days of Access** (crypto, when enabled) — pick any 1–365 days; marginal per-day pricing gets cheaper the longer you buy (first day $1.99; **30 days $4.99** — same as the card pass). Env-tunable via `BREAKBPM_DAY_PASS_*`.
- **Lifetime** — $24.99 one-time, full access forever (stops any active subscription from renewing)
- **Lucky Break** — $4.99 "roll the rack" unlock, sold via redeem code. Every roll is a guaranteed win: at minimum **30 days of access**, with a disclosed chance (**20% by default**, server-configurable) of a **Lifetime Pass**.
- **30 Day Pass** — $4.99 / 30 days, also available **off-platform by card** via the Squarespace store (`BREAKBPM_STORE_URL`); redeem code emailed within 24 hours. Same price as buying 30 days via crypto — choose whichever payment method you prefer.
- **Redeem codes are the active paid path today** (Lucky Break codes, admin-minted comp codes, and card-store codes). Card checkout via **Stripe** and crypto checkout (Base USDC / native ETH) are fully built but gated behind env flags and currently off — cards by `BREAKBPM_CARD_PAYMENTS_ENABLED`, crypto by `BREAKBPM_CRYPTO_PAYMENTS_ENABLED` (plus `BREAKBPM_CRYPTO_RECEIVING_ADDRESS`). Legacy Stripe subscriptions can still be **cancelled** so existing subscribers can stop renewing.
- **Free pass giveaway** — monthly stock pools on the landing page (`BREAKBPM_FREE_PASS_MONTHLY_CAP`, default 15 per reward type).
- See [PERMISSIONS.md](./PERMISSIONS.md) for the full tier / entitlement / feature-access model.

**Lucky Break — provably fair**
- Redeeming a Lucky Break code triggers a server-side draw against a **disclosed Lifetime probability** (default **20%**, the rest land on the 30-day floor). The odds never change based on how you play — they are set server-side via the `BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY` env var (a decimal fraction in `[0,1]`) and always shown before you roll.
- The draw is **seeded** — not biased — by data: BreakBPM hashes (SHA-256) the **global** shot activity across all players from the **last 30 days** together with the roll's server-assigned redemption id, maps the hash to a number in `[0, 1)`, and awards Lifetime when that number is below the disclosed probability.
- "Seeded" means that shot history only shuffles *which* deterministic outcome a given roll lands on; it cannot move the disclosed line. The redemption id makes every code's draw unique and impossible to re-roll.
- Each roll's seed hash, shot-window count, outcome, and the odds it was drawn against are recorded server-side and shown on the reveal screen for transparency — historical rolls keep their original odds even if the env var is later changed.

**Admin tools**
- Allowlisted admins (via `BREAKBPM_ADMIN_EMAILS`) get an account-page panel to mint pass-granting redeem codes — pick the tier (Day / 30 Day / Month / Year / Lifetime) and how many times the code can be used (or unlimited), then share it.
- Admins are treated as Lifetime-pass holders, so they get every Lifetime perk (Day-Pass gifting, custom screen names) without buying a pass.
- Admins can also manage venues, view a CAD sales report (the ledger freezes a USD→CAD rate at sale time for Canadian tax reporting), and inspect the anti-cheat leaderboard.

## How to Run

```bash
pnpm install
pnpm --filter @workspace/breakbpm run dev   # frontend (reads PORT env)
pnpm --filter @workspace/api-server run dev # backend (port 8080)
```

Required env: `DATABASE_URL` (Postgres). Auth is provided by Clerk; the frontend reads a Clerk publishable key. See [docs/ENV.md](./docs/ENV.md) for optional env flags (Lucky Break odds, card/crypto toggles, day-pass pricing, admin emails, etc.).

```bash
pnpm run typecheck          # canonical check across all packages
pnpm run build              # typecheck + build
pnpm --filter @workspace/api-spec run codegen  # after any OpenAPI spec change
pnpm --filter @workspace/db run push          # push DB schema (dev only)
```

## Project Structure

```
artifacts/
  breakbpm/src/             React frontend
    App.tsx                 App shell — routing, game persistence, auth gating
    ABOUT.md                In-app guide copy (bundled, rendered as markdown)
    lib/
      gameLogic.ts          Core rules, BPM calculation (pure TypeScript)
      authClient.tsx        Clerk seam — useAuth(), AuthProvider
      pendingRedeem.ts      localStorage stash for /redeem/:code links
      pendingInvite.ts      localStorage stash for /invite/:code links
      landingContent.ts     Shared SEO copy (prerender + React screens)
    components/
      SetupScreen.tsx       Game setup — mode, players, signed-in name lock, @mentions
      GameScreen.tsx        Active HUD — shot log, per-player BPM, ball selector, Rematch
      StatsScreen.tsx       Tiered shooting statistics (retro CRT styling)
      LeaderboardScreen.tsx Global, hall, and city leaderboards
      JoinedGameScreen.tsx  View-only HUD for joiners + spectators (also OBS overlay)
      WatchByNameScreen.tsx Spectate a player's live game by name
      ObsOverlay.tsx        Chrome-free transparent overlay primitives
      PlayerProfileScreen.tsx  Public profile (reuses the stats hero)
      AccountScreen.tsx     Profile, pass/subscription status, history, mentions, delete-my-data
      PassesScreen.tsx      Lucky Break roll + (flag-gated) card/crypto purchase + redeem
      LuckyBreakReveal.tsx  "Rolling the rack" reveal overlay
      RedeemScreen.tsx      Auto-applies a code from a /redeem/:code share link
      InviteScreen.tsx      Auto-applies an invite from a /invite/:code share link
      CryptoCheckout.tsx    Crypto (Base USDC / ETH) checkout flow
      FindPlayersScreen.tsx Find Players posts + venue map + nearest-hall compass
      ForVenuesScreen.tsx   Pool-hall listing pitch page
      AdminSalesPanel.tsx   Admin CAD sales report
      AdminVenuesPanel.tsx  Admin venue management
      LegalScreen.tsx       Renders the legal docs in src/legal/
  api-server/src/           Express backend
    routes/                 games.ts, auth.ts, passes.ts, subscriptions.ts, crypto.ts,
                            venues.ts, findPlayers.ts, admin.ts, config.ts, health.ts
    lib/                    stats.ts, entitlement.ts, subscriptions.ts, luckyBreak.ts,
                            pricing.ts, fx.ts, tax.ts, saleEvents.ts, geocode.ts,
                            shareCode.ts, forfeit.ts, config.ts, gameSummary.ts
lib/
  db/src/schema/            Drizzle schema (users, games + game_participants, passes,
                            subscriptions, discountCodes, luckyBreak, mentions,
                            cryptoOrders, venues, findPlayers, saleEvents, inviteRedemptions)
  api-spec/openapi.yaml     OpenAPI 3.1 contract (source of truth)
  api-zod/ api-client-react/  Generated types + React Query hooks
docs/
  ARCHITECTURE.md           System design & key decisions
  GOTCHAS.md                Tribal knowledge for contributors
  ENV.md                    Runtime environment variables
```

Repo-root docs: [PERMISSIONS.md](./PERMISSIONS.md) (tier / entitlement reference), [CONTRIBUTING.md](./CONTRIBUTING.md), [CHANGELOG.md](./CHANGELOG.md).

## License

BreakBPM is open-source software licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

This license ensures full transparency: the source code is public, and anyone who modifies and runs it as a network service must make their modifications available under the same license.

**Commercial / Closed-Source Use**
If you want to use BreakBPM (or a modified version) in a commercial product **without** the AGPL copyleft obligations, a paid commercial license is available. See the [LICENSE](./LICENSE) file or contact me directly (@ThatOtherZach on GitHub or X) for details.

## Credits

Built with Grok (xAI), Claude (Anthropic), and Replit Agent.
Original idea by [@ThatOtherZach](https://x.com/ThatOtherZach)

*Let's keep the BreakBPM high.* 🎱