---
name: Overpass billiards-venue proxy
description: Why the OSM venue layer must go through a server proxy, not the browser, and how to keep it reliable.
---

# Overpass billiards-venue fetch must be server-side

The Find Players map's OSM venue layer + nearest-hall compass fetch billiards
venues from OpenStreetMap (Overpass API). This MUST be done by the api-server
(`GET /venues/osm` → `lib/osmVenues.ts`), never by the browser.

**Why the browser fails:**
- Browsers can't set a contact `User-Agent` (a forbidden request header), which
  Overpass etiquette expects.
- Overpass's WAF (mod_security) returns **HTTP 406** for the multi-clause
  parenthesized UNION query from residential IPs — *intermittently*. This is the
  exact symptom behind "Couldn't reach the venue map" (`load-error` phase).

**How to keep it reliable (the levers a browser lacks):**
- **Single-clause queries, never the union.** Issue each tag clause
  (`sport=billiards`, `leisure=adult_gaming_centre`, `billiards=yes`) as its own
  `nwr[...]` request and merge/dedupe server-side. The union is what trips the
  406; single clauses pass.
- **Mirror fallback is essential, not optional.** The public Overpass mirrors
  (overpass-api.de, kumi.systems, private.coffee, osm.ch) are individually flaky
  — at any given moment some return 504 or are simply unreachable (connection
  refused). Verified live: 2 of 4 mirrors down while the primary served 50
  venues. Try mirrors in order; accept the first that yields ≥1 successful clause.
- **Accept partial-clause success.** If one clause 200s and others 406/timeout,
  return what you got rather than failing the whole layer.
- **Cache hard.** 24h fresh + 7d stale-if-error, keyed by a snapped (coarse-grid)
  bbox, so Overpass is hit ~once per region per day — that volume cap is what
  keeps a shared egress IP from being reputation-throttled.

**Don't trust a single raw curl when sanity-checking.** Overpass status flaps
(a single-clause request can 504 one second and 200 the next); test across
mirrors before concluding anything about WAF vs load.
