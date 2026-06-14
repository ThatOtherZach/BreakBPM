---
name: Verified-venue list vs nearest-hall compass data needs
description: Why GET /venues must serve two shapes (paginated list + all) and how the compass coupling can silently break.
---

The verified-halls UI (FindPlayersScreen, under "Nearest Hall") drives TWO consumers off `GET /venues`:

- **The list** under the compass — should be paginated (`page`/`limit`, newest-first) so the payload stays small as the directory grows.
- **The nearest-hall compass** (`NearestHallCompass`) — computes the GLOBALLY closest hall, so it needs EVERY active verified venue, not just one page.

**Why:** these share the same data source. Naively paginating `GET /venues` and feeding the page to the compass silently breaks "nearest hall" (it would only consider the loaded page, e.g. 5 venues).

**How to apply:** mirror the find-players pattern — `GET /venues` takes `page`/`limit` AND an `all=true` flag (returns every active venue in one page). The list uses `{ page, limit }`; the compass uses `{ all: true }` as a separate query. Nearest-first sorting of the LIST is page-local (reorders only the loaded page). If venue counts ever get large enough that the compass's `all` fetch hurts, the real fix is server-side nearest computation (a new endpoint), not shrinking the compass's candidate set.
