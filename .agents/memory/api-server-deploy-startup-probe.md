---
name: api-server deploy startup-probe race
description: Why api-server/index.ts must bind the port fast (http bootstrap + esbuild splitting + load ./app only after first probe) or the autoscale deploy promote fails.
---

The autoscale deploy promote step runs a startup health probe against
`/api/healthz` that fires within the first ~second and only retries a few
times (~350ms apart, ~3 strikes) before failing the promote. If the port
isn't listening yet the probe gets connection-refused (HTTP 500) and gives up.

**The trap:** a normal `import app from "./app"` in index.ts forces V8 to
parse the entire multi-MB esbuild bundle AND evaluate the heavy module graph
(Clerk, Stripe SDK, viem, stripe-replit-sync) before `app.listen` runs. On the
1-vCPU deploy machine that pushed time-to-listen to ~2s — past the probe
budget. The single-bundle PARSE cost dominates; deferring only the eval is not
enough (eval was ~170ms, parse of the 4.7MB bundle was the rest).

**The fix (keep all three together):**
1. esbuild `splitting: true` (build.mjs) so the dynamically-imported `./app`
   lands in its own chunk and the entry index.mjs stays a few KB → fast parse.
2. index.ts binds the port with a tiny raw-`http` bootstrap that answers
   `/api/healthz` 200 directly, then hands off to the `import("./app")` default
   Express app once loaded (`app(req,res)`).
3. Defer the heavy `import("./app")` until AFTER a health probe is answered
   (with a fallback timer for dev where no probe arrives). Parsing the app
   chunk BLOCKS the event loop synchronously (~600ms+), so if you start it
   right after `listen`, a probe arriving during the parse queues behind it and
   can time out. Loading only after answering one probe keeps the event loop
   free for that first 200.

**Why it matters / how to apply:** Do NOT add heavy static imports to
index.ts, do NOT remove esbuild splitting, and do NOT move the app load to run
immediately after `listen` — any of these re-breaks the deploy. App-load
failure must still `process.exit(1)` so a genuinely broken build fails the
promote instead of being masked by the bootstrap's early health 200s. When
validating, measure FIRST-HTTP-200 time, not just time-to-listen (they differ
because of the event-loop-block point above). Verified numbers: time-to-listen
~1200ms→~370ms; first-200 ~1100ms→~350-520ms on dev.
