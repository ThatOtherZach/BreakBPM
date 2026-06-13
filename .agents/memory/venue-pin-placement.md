---
name: Venue pin placement & drift causes
description: Why verified-venue map pins drift, and the address-authoritative rule that fixes it.
---

Verified-venue pins on the Find Players map are placed **only** by the stored
`latitude`/`longitude` on the `venues` row. There are two distinct "drifting
pins" causes — diagnose which before fixing:

1. **CSS render drift** (pins slide off the tiles as you pan, worse at edges):
   the `.fpp-venue-pin` divIcon class must stay `position: absolute` (see
   `leaflet-marker-position.md`). Already fixed/guarded in index.css.
2. **Bad stored coordinates** (pins sit in a consistently wrong spot): the
   admin clicked the map roughly or hand-typed lat/lng that never matched the
   real hall. This is bad DATA, not rendering — confirm by geocoding the saved
   address and measuring haversine drift before "fixing" anything.

**Rule: the saved address is authoritative for coordinates (server-side).**
`venues.ts` `resolveVenueCoords()` runs on every create/update: if the row has
a nonblank `address`, the server geocodes it (`lib/geocode.ts`
`geocodeAddress`, Nominatim `/search`, 8s timeout, range-validated) and stores
THOSE coords — the submitted lat/lng are only a fallback used when the address
is blank OR geocoding fails. Existing drifted rows are repaired in bulk via the
admin-only `POST /admin/venues/repair-coordinates` + the "Fix all pins from
addresses" button in AdminVenuesPanel (re-geocode all, update when drift ≥1m).

**Invariant — NEVER overwrite coordinates on geocode failure.** `geocodeAddress`
returns `null` on any failure (network/timeout/non-2xx/no-hit/parse/out-of-range)
and every caller keeps the prior coords + reports `failed`. Real prod data has
addresses that genuinely don't geocode (e.g. some Thai venues returned no hit)
whose stored coords are already fine — clobbering them with a guess is the bug,
not the fix.

**Why server-side authoritative (not the old manual "Locate" button):** a
per-venue manual "Locate from address" button was shipped first and REJECTED as
still broken — it didn't correct what users saw on the live map and relied on an
admin re-editing every row. Making the address authoritative on save + a
one-click bulk repair is what actually fixes the live pins.

**Operational:** production DB is read-only from tooling, so the fix is
deploy-then-admin-clicks-once: after publish, admin opens Admin Venues → "Fix
all pins from addresses". Geocoder calls are throttled ~1.1s (Nominatim ≤1/sec),
so a large set takes a little while.

**Gotcha:** a Nominatim `/search` query built from the venue **name** (or
name + city) returns `[]`. Query the **street address** (locality is appended
for disambiguation: `"110 E 11th St, New York"`). Street addresses geocode
reliably; names do not.
