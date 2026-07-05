---
name: replit.md is a lean index; detail lives in docs/
description: Where to put new project documentation so replit.md stays scannable
---

**Rule:** `replit.md` is a lean index (~80 lines). Detailed documentation lives in `docs/`: `ENV.md` (all `BREAKBPM_*` vars incl. banned-words matching semantics), `ARCHITECTURE.md` (design decisions, key files), `PRODUCT.md` (feature-by-feature reference incl. passes/pricing), `GOTCHAS.md` (categorized footguns), plus root `PERMISSIONS.md` (tier matrix).

**Why:** replit.md is always loaded into agent context; it had grown to 144 dense lines with multi-hundred-word bullets, crowding out useful context. The owner asked for it to be fixed (July 2026).

**How to apply:** When documenting a new env var, architecture decision, product feature, or gotcha — add the detail to the matching `docs/` file and, only if it's a rule agents must always know (lockstep warnings, gating rules), a ONE-line summary in replit.md. Never paste multi-sentence detail back into replit.md.
