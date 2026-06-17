import sharkUrl from "/shark.jpg";
import poolPlayerUrl from "/pool-player.jpg";
import hustlerUrl from "/hustler.jpg";

/**
 * The three splash artworks a paid player's redeem card and public watch
 * profile can wear. The artwork is CHOSEN AND STORED when an admin mints the
 * card (`discount_codes.backgroundVariant`) — the card renders the stored
 * variant and the redeemer's profile reads it back, so they always match. No
 * client/server hashing is involved.
 *
 * LOCKSTEP: this variant order mirrors `BACKGROUND_VARIANTS` server-side in
 * `artifacts/api-server/src/lib/profileBackground.ts`; both must list the same
 * variant ids so the stored value maps to the same artwork on both sides.
 */
export const BACKGROUND_VARIANTS = ["shark", "pool-player", "hustler"] as const;
export type BackgroundVariant = (typeof BACKGROUND_VARIANTS)[number];

/** Maps a variant id to its Vite-bundled image URL (client only). */
export const VARIANT_IMAGE_URLS: Record<BackgroundVariant, string> = {
  shark: sharkUrl,
  "pool-player": poolPlayerUrl,
  hustler: hustlerUrl,
};
