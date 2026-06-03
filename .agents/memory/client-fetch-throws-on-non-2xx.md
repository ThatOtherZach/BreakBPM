---
name: Client customFetch throws on non-2xx
description: Why in-body error "reason" fields (e.g. rate_limited) are unreachable in the React UI for public read routes
---

The generated React Query client's `customFetch` throws `ApiError` on any non-2xx
response. So any server route that returns an HTTP error status (e.g. `429`) with a
JSON body like `{ found:false, reason:"rate_limited" }` will surface in the UI as
`query.isError`, NOT as `query.data` — the in-body `reason` is effectively unreachable
from the component.

**Why:** Public read routes (`/games/watch-resolve`, `/games/profile`,
`/games/state`) return `res.status(429).json({ ..., reason:"rate_limited" })`. The
spec documents that body, but the UI can only branch on it if it inspects
`ApiError.status === 429`. Otherwise it falls into the generic "couldn't reach the
server" error path.

**How to apply:** This is the established pattern across these routes — match it
(429 + body) rather than diverging to 200-with-reason for one route. If you actually
need rate-limit-specific UI copy, handle `ApiError.status === 429` explicitly in the
component's error branch instead of reading `data.reason`. Don't assume `data.reason`
is observable for any non-2xx response.
