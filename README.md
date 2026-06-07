# BreakBPM

**A retro Windows 98-style pool & billiards scorer with live per-player Balls-Per-Minute (BPM) tracking.**

From the opening break to the final 8-ball — log every shot, watch your pace, resume across devices, and play with friends via a 5-character share code or shareable link. Track your shooting stats over time, let others join an open seat or spectate live, or grind solo with **Shark Mode** — the ultimate solo 8-ball challenge where an invisible predator steals balls on your mistakes.

> *"BreakBPM — the score that starts at the break and ends when you win."*

**Copyright © 2026 Zachary Jordan. I am the sole copyright holder of BreakBPM. All rights not explicitly granted under the AGPL-3.0 are reserved.**

## Current Version: v0.7 (Stats + Join/Spectate + Subscriptions)

A fully functional **React + Vite + TypeScript** web app styled like genuine 1998 Windows software. Built mobile-first with a complete Windows 98 / PC-98 design system, user accounts, game history, a tiered statistics page, live join & spectate, and passes/subscriptions.

### Key Features

**UI & Experience**
- Authentic Windows 98 aesthetic (3D buttons, sunken inputs, beveled panels, MS Sans Serif font, custom scrollbars)
- Green CRT terminal-style game area with stats and pocketed balls
- Retro PC-98 console styling throughout, including the statistics page

**Game Modes**
- **8-Ball**: Full rules with Solids vs Stripes, Golden Break, foul-on-8 loss, up to 4 players
- **9-Ball**: Lowest ball first, sink the 9 to win
- **Shark Mode** 🦈: Solo 8-ball vs the invisible Shark. Miss (or foul on Hard) and it steals a ball. Normal vs Hard aggression toggle. Ball removal is honor-system — lift an easy-looking Shark ball off the real table, or shoot one of its balls yourself, then tap it in the selector to keep the on-screen rack in sync.
- **Practice Mode**: Solo drills with no win conditions

**Gameplay**
- Up to 4 players with automatic or manual team assignment (solids/stripes)
- Smart ball selector — only shows legal/available balls
- Live per-player BPM + timer (anchored to each player's first pocket)
- HUD sublabel shows remaining balls for the current shooter's group (including the 8), or "8-BALL TO WIN" once their group is cleared
- Per-shot BPM stamped on every pocketing entry in the shot log
- Foul detection, undo, shot history
- Win screen with final stats

**Statistics**
- Dedicated `/stats` page with results, accuracy, pace, and ball/pattern breakdowns
- Tiered access: anonymous players see a global 24h view; signed-in players see personal 24h stats; pass/subscription holders unlock selectable windows (24h / 30d / 365d / all), a personal-vs-global toggle, and live refresh

**Multiplayer — one host, many viewers**
- Every game has a 5-character share code; the host's device is the canonical scorekeeper
- **Join** an open seat before the break (view-only, guests welcome, leave/forfeit anytime)
- **Spectate** any live game by player name without a code — a perk available when the host has a paid plan
- Full game state also encoded in the URL for instant link-sharing

**Accounts & Persistence**
- Sign in with Clerk — screen name, email, profile management
- Player 1 name auto-filled from your account and locked (all game modes) to keep BPM history accurate
- In-progress games synced to the server — resume on a different device
- Full game history saved per account (limited for free users)

**Plans**
- **Lucky Break** — $5.99 "roll the rack" unlock, sold via redeem code. Every roll is a guaranteed win: at minimum a 30-day **Monthly Pass**, with a disclosed chance (**20% by default**, server-configurable) of a **Lifetime Pass**.
- **Day Pass** — $1.99 one-time, 24 hours of full access
- **Monthly** — $4.99 / month subscription, cancel anytime
- **Yearly** — $24.99 / year subscription, cancel anytime
- **Lifetime** — $49.99 one-time, full access forever (stops any active subscription from renewing)
- Redeemable via a code or by card via Stripe checkout (card checkout is gated behind the `BREAKBPM_CARD_PAYMENTS_ENABLED` env flag, currently on)

**Lucky Break — provably fair**
- Redeeming a Lucky Break code triggers a server-side draw against a **disclosed Lifetime probability** (default **20%**, the rest land on the Monthly floor). The odds never change based on how you play — they are set server-side via the `BREAKBPM_LUCKY_BREAK_LIFETIME_PROBABILITY` env var (a decimal fraction in `[0,1]`) and always shown before you roll.
- The draw is **seeded** — not biased — by data: BreakBPM hashes (SHA-256) the **global** shot activity across all players from the **last 30 days** together with the roll's server-assigned redemption id, maps the hash to a number in `[0, 1)`, and awards Lifetime when that number is below the disclosed probability.
- "Seeded" means that shot history only shuffles *which* deterministic outcome a given roll lands on; it cannot move the disclosed line. The redemption id makes every code's draw unique and impossible to re-roll.
- Each roll's seed hash, shot-window count, outcome, and the odds it was drawn against are recorded server-side and shown on the reveal screen for transparency — historical rolls keep their original odds even if the env var is later changed.

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
    ABOUT.md                About-page copy (bundled, rendered as markdown)
    lib/gameLogic.ts        Core rules, BPM calculation (pure TypeScript)
    lib/authClient.tsx      Clerk seam — useAuth(), AuthProvider
    components/
      SetupScreen.tsx       Game setup — mode, players, name lock for signed-in users
      GameScreen.tsx        Active HUD — shot log, per-player BPM, ball selector
      StatsScreen.tsx       Tiered shooting statistics (retro CRT styling)
      JoinedGameScreen.tsx  View-only HUD for joiners + spectators
      WatchByNameScreen.tsx Spectate a player's live game by name
      AccountScreen.tsx     Profile, pass/subscription status, game history
      PassesScreen.tsx      Pass + subscription purchase / redeem
  api-server/src/
    routes/                 games.ts, auth.ts, passes.ts, subscriptions.ts, health.ts
    lib/                    stats.ts, entitlement.ts, subscriptions.ts, shareCode.ts
lib/
  db/src/schema/            Drizzle schema (users, games + game_participants,
                            passes, subscriptions, discountCodes)
  api-spec/openapi.yaml     OpenAPI 3.1 contract (source of truth)
  api-zod/ api-client-react/  Generated types + React Query hooks
```

## License

BreakBPM is open-source software licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

This license ensures full transparency: the source code is public, and anyone who modifies and runs it as a network service must make their modifications available under the same license.

**Commercial / Closed-Source Use**
If you want to use BreakBPM (or a modified version) in a commercial product **without** the AGPL copyleft obligations, a paid commercial license is available. See the [LICENSE](./LICENSE) file or contact me directly (@ThatOtherZach on GitHub or X) for details.

## Credits

Built with Grok (xAI), Claude (Anthropic), and Replit Agent.
Original idea by [@ThatOtherZach](https://x.com/ThatOtherZach)

*Let's keep the BreakBPM high.* 🎱
