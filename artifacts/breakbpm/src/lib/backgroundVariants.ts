import sharkUrl from "/shark.jpg";
import poolPlayerUrl from "/pool-player.jpg";
import hustlerUrl from "/hustler.jpg";

/**
 * The three splash artworks a paid player's redeem card and public watch
 * profile can wear. Order is significant — it is the index space the
 * deterministic picker maps into, so the card and the profile background agree
 * on which artwork a given key resolves to.
 *
 * LOCKSTEP: this variant order AND the hash in `backgroundVariantForKey` are
 * mirrored server-side in `artifacts/api-server/src/lib/profileBackground.ts`.
 * Both must stay identical or the redeem card (client-drawn) and the watch
 * profile background (server-resolved) will pick different artwork for the same
 * pass. `redeemCard.test.ts` and `profileBackground.test.ts` pin the mapping.
 */
export const BACKGROUND_VARIANTS = ["shark", "pool-player", "hustler"] as const;
export type BackgroundVariant = (typeof BACKGROUND_VARIANTS)[number];

/** Maps a variant id to its Vite-bundled image URL (client only). */
export const VARIANT_IMAGE_URLS: Record<BackgroundVariant, string> = {
  shark: sharkUrl,
  "pool-player": poolPlayerUrl,
  hustler: hustlerUrl,
};

/**
 * Deterministically pick a background variant for an arbitrary string key
 * (a redeem code, a pass id, etc.). Pure and engine-independent (djb2 over the
 * upper-cased, trimmed key) so the same key always yields the same artwork on
 * both the client card and the server profile resolver.
 */
export function backgroundVariantForKey(key: string): BackgroundVariant {
  const norm = key.trim().toUpperCase();
  let h = 5381;
  for (let i = 0; i < norm.length; i++) {
    h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;
  }
  return BACKGROUND_VARIANTS[h % BACKGROUND_VARIANTS.length];
}
