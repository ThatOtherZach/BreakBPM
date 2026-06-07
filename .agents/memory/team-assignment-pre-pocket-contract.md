---
name: Team-assignment pre-pocket contract
description: shouldAssignTeams sees pre-pocket sunkBalls/shotLog; the ruleSet timing logic depends on this ordering.
---

`shouldAssignTeams(gameType, teamAssigned, sunkBalls, shotLog, ballSunk, ruleSet)` is
called by `GameScreen.sinkBall()` **before** the freshly pocketed ball is appended to
`sunkBalls`/`shotLog`. So inside the engine, `sunkBalls`/`shotLog` reflect the state
*prior* to this pocket, and `ballSunk` is the ball being pocketed right now.

**Why:** the 8-ball rule-set options encode timing relative to this ordering:
- `second-ball` checks `priorNon8 === 1` (one non-8 already down → this is the 2nd).
- `open-through-break` requires a turn-ending event (`miss`/`foul`/`safety`) to already
  exist in `shotLog` (the break shot has ended) before the next non-8 pocket locks groups.

**How to apply:** if you ever move the append before the `shouldAssignTeams` call, the
off-by-one breaks every rule set silently. Keep the call pre-append, or rewrite the
counting (`priorNon8`) and break-end detection accordingly.
