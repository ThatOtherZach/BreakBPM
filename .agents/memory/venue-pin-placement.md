---
name: Venue pin placement & drift causes
description: Why verified-venue map pins drift, and how admins geocode an address to fix it.
---

Verified-venue pins on the Find Players map are placed **only** by the stored
`latitude`/`longitude` on the `venues` row. There are two distinct "drifting
pins" causes — diagnose which before fixing:

1. **CSS render drift** (pins slide off the tiles as you pan, worse at edges):
   the `.fpp-venue-pin` divIcon class must stay `position: absolute` (see
   `leaflet-marker-position.md`). Already fixed/guarded in index.css.
2. **Bad stored coordinates** (pins sit in a consistently wrong spot): the
   admin clicked the map roughly or hand-typed lat/lng. The fix is to derive
   coords from the venue's `address`.

**Address → coordinates (forward geocode):** AdminVenuesPanel has a "Locate
from address" button that calls Nominatim `/search` client-side (mirrors the
existing reverse-geocode preview in FindPlayersScreen), fills the lat/lng
inputs, and recenters the map for visual confirmation. Saved coords are still
range-validated server-side.

**Gotcha:** a Nominatim `/search` query built from the venue **name** (or
name + city) returns `[]`. You must query the **street address** (we append
locality for disambiguation: `"110 E 11th St, New York"`). Street addresses
geocode reliably; names do not.

**Why manual button, not auto-geocode-on-save:** admin-entered addresses are
"generally correct," not always — the admin should eyeball the pin before
committing. Existing rows aren't backfilled automatically; they're fixed via
Edit → Locate → Save.
