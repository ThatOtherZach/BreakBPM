# Product

What BreakBPM offers users, feature by feature. For system design see [ARCHITECTURE.md](./ARCHITECTURE.md); for tier/feature access rules see [PERMISSIONS.md](../PERMISSIONS.md).

## Game modes

- **8-ball** — 2P/4P with teams, or 1P Shark. Shark = solo 8-ball vs an invisible honor-system AI (Normal steals on miss; Hard steals on miss + foul).
- **9-ball**
- **Practice**

## BPM tracking

Live per-player pace in the HUD; per-shot BPM stamped on pocketing entries. The HUD sublabel shows balls/group remaining.

## Signed-in name lock

The Player 1 name is prefilled + read-only when logged in (prevents stat pollution).

## Join & spectate

Each game has a 5-char share code; others join an open seat before the break (view-only, guests allowed) or spectate by name. Joiners/spectators never score.

## @Mention

Paid hosts link a registered friend by `@username` (no shared device needed); the friend gets an opt-in invite after the game finishes.

## Stats & leaderboards

- `/stats` shows accuracy, pace, and ball/pattern breakdowns (retro CRT styling) with tier-gated windows. Recent Chaos winners get a rainbow AVG-BPM flourish.
- Separate **8-ball** and **9-ball** leaderboards ranked on a composite skill score (accuracy-weighted, trust-weighted pace; best-2 of ≥2 qualifying 1-on-1 games) — players appear after just 2 games.
- Anti-cheat signals (raw composite score, registered-vs-registered game count, thin-sample "provisional" flag) are hidden from players and surfaced only on an admin-only board (`GET /admin/leaderboard`).
- Per-venue **Local Leaderboards**: when a 1-on-1 8/9-ball game finishes, its host can 🏆 tag it — once, while on location — to a nearby Verified Hall, putting that game on the hall's own ranked board (and the rolled-up **City** board for that locality); if no hall is in range, the host can tag the city directly. Both boards are reachable from Find Players and the verified-hall cards (each card's locality is a clickable city link).
- Free accounts see the 30-day window; passes unlock 90-day/all-time.

## List your hall (free)

Pool halls can claim a free Verified-Hall listing via the `/for-venues` pitch page — their own Local Leaderboard, map discovery, and a website backlink in exchange for one social media post tagging #BreakBPM with a link to their hall page.

## Rematch / Resume

Signed-in players get a one-tap Rematch at game end (fresh game, same settings); logged-in users can resume an in-progress game cross-device.

## Passes (crypto + redeem codes)

Free to play; sign in (free) to save stats.

- **Purchase Days of Access (crypto)** — any 1–365 days priced on marginal per-day brackets that get cheaper the more days you add (a single day is $1.99; **30 days is $4.99** — same as the card 30 Day Pass). The bracket set is env-tunable via `BREAKBPM_DAY_PASS_*` and shipped to the client via `/passes/plans`.
- **Lifetime** — $24.99 (crypto). Adds custom screen names.
- **Lucky Break** — $4.99 (crypto or redeem code). See below.
- None auto-renew.
- The original fixed Day/Month/Year/Lifetime one-time pass *kinds* still exist (the flexible pass issues a `day` kind with a custom duration, and redeem codes can still grant any kind), but Day/Month/Year are no longer sold directly via crypto.
- **30 Day Pass (card, off-platform)** — $4.99 / 30d, internal kind `twoweek` (legacy name predating the current 30-day terms). Sold via the owner's Squarespace store (`BREAKBPM_STORE_URL`): the buyer pays by card there, then the owner manually mints a "30 Day Pass" admin redeem code (existing admin generator) and emails it (≤24h). **Same $4.99 / 30d price on both platforms** — only fulfillment differs (card code by email; crypto grants instantly). The card pass is NOT a fixed crypto catalog item (absent from `CRYPTO_PASS_PLANS`).
- Passes unlock full history, stats windows, spectating, Find Players posting, @mention, leaderboard windows, and full export.
- Legacy Stripe card checkout + recurring subscriptions exist behind an env flag, currently off; existing subscriptions can still cancel.

## Lucky Break

A $4.99 "roll the rack" — a guaranteed ≥30-day pass with a disclosed ~20% chance of Lifetime, shown via a provably-fair seeded reveal (see [ARCHITECTURE.md](./ARCHITECTURE.md#lucky-break-provably-fair-roll)).

## Redeem share links

`/redeem/:code` stashes the code (30-min TTL, survives the sign-up redirect) then auto-applies `/passes/redeem` once signed in, including the Lucky Break reveal.

## Invite link → free trial (one-sided, once per new user)

Every signed-in user has a personal, lazily-minted invite code (`users.inviteCode`, unique; `GET /passes/invite`). A NEW user who follows `/invite/{code}` and signs up gets a short, env-configurable free trial via `POST /passes/invite/accept` (`BREAKBPM_INVITE_TRIAL_HOURS`, issues a `day` pass with a custom sub-day duration).

- The whole accept runs in one tx: it resolves the inviter by code, blocks self-invites and non-new users (`INVITE_SIGNUP_WINDOW_MS` = 30 min on `createdAt`), pre-checks for an existing active pass, then grants + books a $0 comp in the sales ledger with a frozen pre-tx BoC FX rate.
- `UNIQUE(invited_user_id)` on `invite_redemptions` is the idempotency backstop (a second accept → `already_redeemed`).
- One-sided — no inviter reward.
- Client mirrors the redeem flow: `pendingInvite.ts` stashes the code across the sign-up redirect (30-min TTL, in lockstep with the server window), `InviteScreen` auto-applies once authed, and the top-level `RedeemResumer` resumes it (deferring to `?code`/`?game` joins and to a pending redeem).

## Admin tools

Allowlisted admins mint pass-granting redeem codes (pick tier + max-uses) from the Account page and get every Lifetime perk without buying a pass.
