# BreakBPM

**The no-bullshit pool scorekeeper.**

Most pool nights turn into a mess — forgotten shots, slow play, bar rules arguments, and nobody remembering what actually happened. BreakBPM cuts through all of it.

## What it does

BreakBPM logs every shot, one ball at a time, and gives you two numbers back: **accuracy** (what actually matters) and **BPM** — a stupid but addictive stat you can compare with your friends.

The higher the BPM, the faster the game moves. It’s calculated per-player from your first pocketed ball, so it reflects *your* pace. No vision AI, no physics simulation, no trying to replace the table. Just a clean remote for the game.

### Game modes
- **8-Ball**: Solids vs Stripes. Golden Break and foul-on-8 included.
- **9-Ball**: Sink in order, win with the 9.
- **Practice**: Unlimited solo racks. Log shots and watch your accuracy improve.
- **🦈 Shark Mode**: Solo 8-ball against an invisible opponent. Miss or foul and the Shark gets a chance to pocket. Honor system — you remove the ball from the real table.

### 8-Ball formats

In 8-Ball, the Format toggle cycles through four ways to play:

- **Normal**: Solids vs Stripes, teams assigned automatically by the rule set you pick.
- **Manual**: Solids vs Stripes, but you pick each player's group yourself.
- **None**: No teams, no winner. Track shots and BPM.
- **Chaos**: No teams, free-for-all, with a win rule of your choice:
  - **8-Ball Last**: Sink the 8 last to win or early to lose.
  - **No Rules**: Anything goes. Clear the table; whoever sank the most wins.

## Play anywhere, with anyone

Every game has a **5-character share code**. One device is the scorekeeper while everyone else follows live.

Join with the code (`breakbpm.com/join/CODE`) before the first ball drops and you’re in the game as a player. Players not signed in will be identified by "Player #".

If all spots ae filled, you join as a spectator. Spectators can join anytime to watch, but as a player you should sign in to save the game history.

**Spectate by name** at `breakbpm.com/watch/USERNAME` to follow someone’s game without needing the code.

**Streaming?** Add `?obs=1` to a watch link for an overlay you can drop straight into OBS as a browser source (`breakbpm.com/watch/USERNAME?obs=1`). Chain flags such as `&log=1` to add a compact shot log and `&scale=1.5` to resize.

## Why BPM?

Because most pool nights suck to keep track of.

Different bar rules. People forgetting what they’re shooting. Slow play. Arguments. After ten years of dealing with it, I built the app I actually wanted — one that strips everything unnecessary away.

BreakBPM doesn’t try to simulate the table or do AI vision bullshit. It just logs your shots and gives you two things:

- **Accuracy** — the real number
- **BPM** — a made-up but fun number to chase and talk shit about with your friends

The higher the BPM, the faster the game moves. That’s it. No fake science. Just something simple to focus on while you’re actually playing.

The app is basically a remote for the table. Simple. Fast. No bullshit.

## Track your stats

The Stats page shows your shooting over time — results, accuracy, pace, and most-sunk balls.

Anyone can see a live 24-hour global snapshot. Sign in to save and view your own numbers. Grab a pass or subscription to unlock full history (30 days, a year, or all-time), compare against everyone, and refresh on demand.

## Features

- Live per-player BPM + game timer
- Smart ball selector (only shows legal shots)
- Full shot log with undo
- Track fouls, safeties, and misses
- Automatic or manual team assignment
- 5-character share code for easy joining
- Spectate by name
- Stats with accuracy and pace breakdowns
- Works in any browser, no install
- Free to play. Sign in to save your stats.

## 🦈 Shark Mode (detailed)

Play solo against an invisible Shark. Your first sink locks your group (solids or stripes); the rest go to the Shark. Clear your group and sink the 8 to win.

Every miss or foul gives the Shark a chance to pocket a ball. This is an honor system — when the Shark “pockets” a ball, you physically remove one of its balls from the real table.

**Two ways to handle it:**
- Pick whichever of the Shark’s balls looks easiest and lift it off the table.
- Line up one of the Shark’s balls and shoot it yourself (playing *as* the Shark). Miss? Remove it anyway.

**Shark Mode Rules**
- Sink a ball → counts for you
- Safety → never triggers a Shark pocket (valid play)
- Only the 8 left + you miss or foul → Shark wins
- Sink the 8 after clearing your group → you win

**Shark Aggression**
- **Normal**: Shark only pockets on fouls
- **Hard**: Shark pockets on every miss *and* every foul

## Passes

BreakBPM is free to play. Sign in (no charge) to save your games — you'll keep your 3 most recent — and resume an in-progress game on any device.

A pass unlocks everything:

- **Post to Find Players** — create meetup posts so other players can find your game. Free accounts can browse the board and map, but only pass holders can post.
- **Let others spectate** — when you host a game with a pass, anyone can watch it live, by share code or by your name. Without a pass, your games can't be spectated.
- **Full game history** — every game you've ever played, not just your last 3, with pagination.
- **Full stats** — switch between 24-hour, 30-day, 365-day, and all-time windows, and refresh on demand. Free accounts see personal stats for the last 24 hours only, but can still toggle over to the all-time global "Everyone" view as a taste.
- **Full data export** — download every game and shot you've ever logged as a CSV. Free accounts can export their last 24 hours only.
- **Custom screen name** — *Lifetime only:* pick your own display name instead of the auto-assigned one.

| Pass     | Price              | Access                                     |
|----------|:------------------:|--------------------------------------------|
| Day Pass | $1.99 one-time     | Everything above for 24 hours              |
| Monthly  | $4.99              | Everything above for 30 days               |
| Yearly   | $14.99             | Everything above for 30 days               |
| Lifetime | $24.99 one-time    | Everything above forever + custom screen name |

Day Pass and Lifetime are one-time purchases. Monthly and Yearly are recurring (cancel anytime). Buying Lifetime stops any active subscription from renewing.

Plans can be purchased from your account page or redeemed with a code.

### 🎱 Lucky Break

Lucky Break is a $4.99 roll that guarantees you a pass — you always win something. Every roll lands on at least a 30-day Monthly Pass, with a disclosed chance (**20% today**) of upgrading to a Lifetime Pass instead. The exact odds are always shown before you roll.

The outcome is determined by a seeded draw using the last 30 days of global shot activity across all players, hashed together with your unique roll ID. The odds never change based on how you or anyone else plays — the shot data only selects which outcome you land on, it doesn't shift the disclosed threshold.

Lucky Break is available to purchase on your passes page — your pass is granted automatically when payment is confirmed.

---

*Built by [@ThatOtherZach](https://github.com/ThatOtherZach). Owned and operated by Saym Services Inc. in Vancouver, Canada.*
