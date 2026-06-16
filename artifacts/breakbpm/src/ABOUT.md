# BreakBPM

BreakBPM logs every shot, one ball at a time, and gives you two numbers back: **accuracy** (what actually matters) and **BPM**, a realative stat you can compare with friends (or no one).

The higher the BPM, the faster the game moves. It’s calculated per-player from your first pocketed ball to the last. Want a sticker? [Grab one here](https://www.redbubble.com/i/sticker/BreakBPM-Sticker-by-ThatOtherZach/181421812/7sgk).

![A seasoned player leans over the table, cue in hand](/hustler.jpg)

## Features
- Live per-player BPM + game timer
- Smart ball selector (only shows legal shots)
- Full shot log with undo
- Track fouls, safeties, and misses
- 5-character share code for easy joining
- Spectate any game
- Link players with @ mentions
- Global BPM leaderboard
- Stats with accuracy and pace breakdowns
- Works in any browser, no install
- Free to play. Sign in to save your stats.
- Data deletion by default, full export included in pass.

### Game Modes
- **8-Ball**: Solids vs Stripes (Golden Break and foul-on-8 incl.)
- **9-Ball**: Sink in order, win on the 9.
- **Practice**: Unlimited solo racks.
- **🦈 Shark Mode**: Solo 8-ball against an invisible shark. Miss and/or foul and the Shark scores a ball.

### 8-Ball Formats

In 8-Ball, the Format toggle cycles through four ways to play:
- **Normal**: Solids vs Stripes, teams assigned automatically by the rule set.
- **Manual**: Solids vs Stripes, rule sets included and you pick each player's grouping.
- **None**: No teams, no winner. Track shots and BPM.
<!-- Shhhh, secret
- **Chaos**: No teams, free-for-all, with a win rule of your choice:
  - **Straight Pool**: Sink the 8 last to win or early to lose.
  - **No Rules**: Anything goes. Clear the table; whoever sank the most wins.
-->

## 🦈 Shark Mode

![🦈 Shark Mode — solo 8-ball against an invisible opponent](/shark.jpg)

Play solo against an invisible Shark. Your first pocketed ball locks your group (solids or stripes); clear your group and sink the 8 ball to win.

Based on the aggression setting, determines when the Shark pockets a ball. It is an honor system; when the Shark “pockets” a ball, you should physically remove one of the Sharks grouping balls from the table.

**Shark Aggression**
- **Normal**: Shark only pockets on fouls
- **Hard**: Shark pockets on every miss *and* every foul

**Two Ways to Play:**
- When its the Sharks turn, pick whichever of the Shark’s balls looks easiest and lift it off the table.
- Or shoot the shark's ball yourself (playing *as* the Shark). Missed? Remove it anyway.

**Shark Mode Rules**
- Sink a ball → counts for you
- Safety → does not trigger a Shark pocket (valid play)
- Only the 8 left + you miss or foul → Shark wins
- Sink the 8 after clearing your group → you win

## Play Anywhere, With Anyone

![BreakBPM game setup screen — pick mode, players, and format](/screenshot-home.jpg)

One device keeps score and acts as host for other players to join using a **5-character share code**. You can copy the code with the 📋 icon, or click-and-hold to reveal a QR code to scan and join. 

Join with the code (`breakbpm.com/join/CODE`) before the first pocketed ball and you’ll be added to the game as a player. Players that are not signed in will be identified as "Player #".

If the game is full (max 4 players), you join as a spectator only. You can also **Spectate by name** at `breakbpm.com/watch/USERNAME` to watch without a code.

<!--**Streaming?** Add `?obs=1` to a watch link for an overlay you can drop straight into OBS as a browser source (`breakbpm.com/watch/USERNAME?obs=1`). Chain flags such as `&log=1` to add a compact shot log and `&scale=1.5` to resize.-->

### Link Friends In

If you have a pass, type `@USERNAME` into another player input during setup to link and save thier stats. No share code needed.

When the game finishes the tagged user can **Accept** or **Delete** the game from thier stats and game history. There is a max number of invites a player can recieve.

## Track Your Racks

The Stats page shows your shooting over time a results including relative accuracy, pace, and ball patterns.

Free 24-hour global snapshot, sign in to save and view your own. Grab a pass to unlock full history (30 days, a year, or all-time) to compare against everyone. Full export included.

## Leaderboard

Who's fastest? The **🏆 Leaderboard** ranks players by BPM across recent 8-ball singles games with a time weighted average, recent games only.

Sign in to open the full leaderboard. Pass holders can switch the ranking window to 90 days or all-time.

## Passes

![BreakBPM Passes & Pricing — Day, Month, Year, Lifetime, Lucky Break](/screenshot-passes.jpg)

BreakBPM is free to play. Sign in (no charge) to save your games, but you'll need a pass to access more data.

Pass Unlocks:
- **Post to Find Players** Create meetup posts for other players to join your game. Free accounts can browse, only pass holders can post.
- **Let others spectate** Hosting with a pass allowes anyone to watch live via the share code or by name. Without a pass, your games can not be spectated.
- **Link players by @mention** Use `@USERNAME` to link a friend to your game without a share code. You do not need a pass to accept an invite, but there is a limit.
- **Leaderboard windows** Over 90 days or all-time, not just the normie 30-day leaderboard.
- **Full game history** See every game you've ever played.
- **Full stats** Switch between 24-hour, 30-day, 365-day, and all-time windows, and refresh on demand. Free accounts see personal stats for the last 24 hours only.
- **Full data export** Download every game and shot you've ever played. Free accounts can only export their last 24 hours only.
- **Custom screen name***Lifetime only:* Pick your own display name instead of the auto-assigned one.

| Pass     | Price              | Access                                     |
|----------|:------------------:|--------------------------------------------|
| Day Pass     | $1.99     | Everything for 24 hours          |
| Month Pass   | $4.99     | Everything for 30 days           |
| Year Pass    | $14.99    | Everything for 365 days          |
| Lifetime     | $24.99    | Everything + custom screen name  |
| 14 Day Pass  | $5.99     | Everything for 14 days (card)    |

Passes can be purchased on-chain with crypto from your account page or redeemed with a code. Prefer to pay by card? The **14 Day Pass** ($5.99) is sold by card on our off-platform store — we email your redeem code within 24 hours. Heads up: paying with crypto is the better deal, since the 30-day Month Pass is only $4.99. All pass types are non-refundable. If you need assistance, use the Github first. 

### 🎱 Lucky Break

Lucky Break is a $4.99 roll that guarantees you a 30 day pass but there's an 80/20 chance it's upgraded to a Lifetime Pass instead.

The outcome is determined by a seeded draw using the last 30 days of global shot activity. You are guarenteed a 30 day pass regardless of winning outcome. Your pass is granted automatically after payment is confirmed.

---

*Built by [@ThatOtherZach](https://github.com/ThatOtherZach). Owned and operated by Saym Services Inc. in Vancouver, Canada.*
