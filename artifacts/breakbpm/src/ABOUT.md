# BreakBPM

BreakBPM was developed by Saym Software Systems in the late 1990s. However, due to the Y2K bug, the software was never officially released, until now!

BreakBPM got started as a bowling score tracker before being augmented into a billiards format. The system logs every shot over your game, one ball at a time, and gives you two numbers back: **accuracy** and **BPM**, a relative stat you can compare with friends (or no one).

That's basically it. Want a sticker? **[Grab one here](https://www.saymservices.com/store/p/breakbpmcom-rack-sticker)**.

![A seasoned player leans over the table, cue in hand](/hustler.jpg)

## Features
- Live per-player BPM + game timer
- Smart ball selector (only shows legal shots)
- Full shot log with undo
- Track fouls, safeties, and misses
- Share code for easy joining
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

The aggression setting determines when the Shark pockets a ball. It is an honor system; when the Shark “pockets” a ball, you should physically remove one of the Shark’s grouping balls from the table.

**Shark Aggression**
- **Normal**: Shark only pockets on fouls
- **Hard**: Shark pockets on every miss *and* every foul

**Two Ways to Play:**
- When it’s the Shark’s turn, pick whichever of the Shark’s balls looks easiest and lift it off the table.
- Or shoot the shark's ball yourself (playing *as* the Shark). Missed? Remove it anyway.

**Shark Mode Rules**
- Sink a ball → counts for you
- Safety → does not trigger a Shark pocket (valid play)
- Only the 8 left + you miss or foul → Shark wins
- Sink the 8 after clearing your group → you win

## Play Anywhere, With Anyone

![BreakBPM live game scoreboard — balls-per-minute, accuracy, and the rack](/screenshot-home.gif)

One device keeps score and acts as host for other players to join using a **5-character share code**. You can copy the code with the 📋 icon, or click-and-hold to reveal a QR code to scan and join. 

Join with the code (`breakbpm.com/join/CODE`) before the first pocketed ball and you’ll be added to the game as a player. Players that are not signed in will be identified as "Player #".

If the game is full (max 4 players), you join as a spectator only. You can also **Spectate by name** at `breakbpm.com/watch/USERNAME` to watch without a code.

### Stream with BreakBPM

Going live? BreakBPM gives you a free, transparent overlay for your stream.

- **Grab the URL.** Open **Account** and find **Stream to OBS** — flip on the shot log if you want it, set the scale, and copy the Browser Source URL. (It's just your watch link with `?obs=1` added: `breakbpm.com/watch/USERNAME?obs=1`.)
- **Add it to OBS.** In OBS Studio (or Streamlabs), add a **Browser Source** and paste the URL. The overlay has a transparent background, so it drops cleanly over your table cam or gameplay.
- **Tweak it.** Chain flags onto the URL: `&log=1` shows a compact shot log, and `&scale=1.5` resizes the whole widget. Between games the overlay quietly collapses to a friendly idle face.

It's the same Windows 98–styled scoreboard you can **Share** as an image at the end of a game — live BPM, accuracy, the rack, and the players, all in one tidy window.

### Link Friends In

If you have a pass, type `@USERNAME` into another player input during setup to link and save their stats. No share code needed.

When the game finishes the tagged user can **Accept** or **Delete** the game from their stats and game history. There is a max number of invites a player can receive.

Can't find players? Pass holders get access to Meetup posts to host billiard events for other players to join. Shy? Use the compass to find the nearest pool hall to your location!

## Rack Up The Leaderboard

![BPM Bell Curve](/bpm-bell-curve.gif)

The Stats page shows your shooting over time, including relative accuracy, pace, and ball patterns.

Sign in to save and view your own, as well as a free 24-hour global view. Use a pass to unlock your full game history to compare against everyone; data export included.

Who's fastest? Use **[the Leaderboard](https://breakbpm.com/leaderboard)** to see your rank by BPM across recent 8-ball singles games (time weighted average). Pass holders can switch the ranking window to 90 days or all-time.

Earn themes as you play each mode, or buy a pass to unlock them all! Lifetime pass holders also get access to a special raindow effect. Sign in to open the full leaderboard.

![Leaderboard example](leaderboard-example.gif)


### Local Leaderboards for Verified Halls

Every Verified Hall has its own **House Leaderboard** — a ranking of the players who shoot there.

Finished an 8-ball or 9-ball game at a verified hall? While you're still on-site, the host can tap **🏆 Tag Leaderboard** at the end of the game and pick the hall. We check your location to confirm you're actually there (within about 300 m), then add that game to the hall's board.

You can also open any hall's board straight from **Find Players** — tap **🏆 House Leaderboard** on a verified hall's card.

A few things to know:
- Rankings come from one-on-one 8-ball and 9-ball games (the two boards are separate), scored on the same pace + accuracy blend as the global leaderboard.
- Only the host can tag a game, only once, and only to the hall they're standing in.
- Sign in to view a House Leaderboard. Free accounts see the last 30 days; pass holders unlock the 90-day and all-time windows.

## Passes

BreakBPM is free to play. Sign in (no charge) to save your games, but you'll need a pass to access more data.

Pass Unlocks:
- **Post to Find Players** Create meetup posts for other players to join your game. Free accounts can browse, only pass holders can post.
- **Let others spectate** Hosting with a pass allows anyone to watch live. Without a pass, your games cannot be spectated.
- **Link players by @mention** Use `@USERNAME` to link a friend into your game. You do not need a pass to accept an invite, but there is a limit.
- **Leaderboard windows** Over 90 days or all-time, not just the 30-day leaderboard.
- **Full game history** See every game you've ever played.
- **Full stats** Switch between 24-hour, 30-day, 365-day, and all-time windows, and refresh on demand. Free accounts see personal stats for the last 24 hours only.
- **Full data export** Download every game and shot you've ever played and export it. Free accounts can only export the last 24 hours only.
- **Custom screen name** — *Lifetime only:* Pick your own display name instead of the auto-assigned one.
- **Custom profile theme** — *Lifetime only:* Choose which artwork appears behind your public watch profile and the color of the felt! Free users can unlock the felt colors, but they are only applied temporarily. 

Passes can be purchased on-chain with crypto from your account page or redeemed with a code. Crypto passes are applied automatically on purchase once payment is confirmed.

Prefer to pay by card? A **14 Day Pass [can be purchased on our off-platform store](https://www.saymservices.com/store/p/breakbpm-14-day-pass)** for $5.99. After purchase a redemption code will be emailed to you within 24 hours. You can try to get a free day pass from a Lifetime pass holder or **[try your luck here](https://breakbpm.com/pool-stats-app)**.

All pass types are non-refundable. If you need assistance, use the Github first.

On BreakBPM you buy however many days of access you want (1 to 365) for $1.99 USD per day. The per-day rate drops the more days you add.

A Lifetime (No Expiry) pass is a one-time purchase of $24.99 USD with crypto or $49.95 on the Saym Services Store.

Prices are current as of June 2026 (USD).

### 🎱 Lucky Break Pass

Lucky Break is a $4.99, 30 day pass, but there's an 80/20 chance it's upgraded to a Lifetime Pass.

The outcome is determined by a seeded draw using the last 30 days of global shot activity. You are guaranteed a 30-day pass regardless of the outcome. Pass is granted automatically after payment is confirmed.

---

*Designed & Built by [@ThatOtherZach](https://github.com/ThatOtherZach). Operated by [Saym Services Inc](https://www.saymservices.com/breakbpm) - Vancouver Canada*
