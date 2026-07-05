---
name: Shared page chrome must skip OBS/live-spectator branches
description: WatchByNameScreen renders three very different surfaces from one component; global chrome (footer/navbar) only belongs on the plain profile branch.
---

`WatchByNameScreen` internally branches into three renders depending on state: the chrome-free OBS overlay (`obs=true`), the live in-game spectator HUD (once a live share code resolves), and the plain `PlayerProfileScreen` view (idle/no live game). Any app-wide page chrome (e.g. the shared header/footer used on every other route) must be threaded only into the `PlayerProfileScreen` branch's props — never rendered at the top of `WatchByNameScreen` itself.

**Why:** the OBS overlay is embedded in streaming software as a transparent Browser Source and must stay chrome-free, and the live spectator view intentionally uses the same in-game status bar as `GameScreen`/`JoinedGameScreen`, not generic page chrome. Rendering shared chrome unconditionally would visually break both.

**How to apply:** when adding any new global UI (banner, footer, nav) that should appear "everywhere except in-game", check whether the target screen is one of these multi-branch renderer components before wiring the prop in at the top level — trace to the specific branch that represents the plain, non-live page state.
