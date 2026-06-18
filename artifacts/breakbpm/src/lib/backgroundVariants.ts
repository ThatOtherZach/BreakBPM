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

/**
 * The themed UI color a profile theme projects onto gameplay surfaces (the HUD
 * pool-table felt and the leaderboard card accent). SINGLE SOURCE OF TRUTH —
 * the HUD, the Account theme picker dots, and the leaderboard cards all map
 * through `themeColorOf` so the three never drift.
 *
 * Mapping: The Shark (shark) → blue, The Hustler (hustler) → red, The Kid
 * (pool-player) → purple, None / no theme → green (the felt's existing
 * default). Purple gives The Kid its own identity so it no longer looks
 * identical to an unthemed (green) table.
 */
export type ThemeColor = "blue" | "red" | "green" | "purple";

/** Map an effective theme/background value to its themed color. Accepts a raw
 * string (any of the generated background/theme union types) so callers don't
 * fight cross-package literal-union typing; anything unrecognized (incl.
 * "none") falls back to green. */
export function themeColorOf(bg: string | null | undefined): ThemeColor {
  if (bg === "shark") return "blue";
  if (bg === "hustler") return "red";
  if (bg === "pool-player") return "purple";
  return "green";
}

/** Pool-table felt shades per theme color: the baize `felt` base and the
 * `feltShadow` used for the inset rail. Green reproduces the current default. */
export const THEME_FELT: Record<ThemeColor, { felt: string; feltShadow: string }> = {
  green: { felt: "#0f5a2e", feltShadow: "#0a4322" },
  blue: { felt: "#0e3a6e", feltShadow: "#0a2a52" },
  // Burgundy kept deliberately dark — darker than every ball fill (incl. the
  // maroon 7/15 #6B1F2A) so the rack chips' black rim + white number circle
  // stay legible on the felt.
  red: { felt: "#54151d", feltShadow: "#3d0f15" },
  // Deep violet kept darker than the purple 4/12 ball (#5B247A) for the same
  // reason as the burgundy felt, so the rack chips stay legible.
  purple: { felt: "#3d2154", feltShadow: "#2a1640" },
};

/** Vivid accent per theme color — used for the leaderboard card stripe and the
 * theme-picker dots, so it reads clearly against the dark felt cards. */
export const THEME_ACCENT: Record<ThemeColor, string> = {
  green: "#37d67a",
  blue: "#3ba7ff",
  red: "#ff5a5f",
  purple: "#a06bff",
};

/** Colored-circle glyph per theme color for native <option> labels (native
 * dropdown options can't be reliably color-styled, so the dot lives in text). */
export const THEME_DOT: Record<ThemeColor, string> = {
  green: "🟢",
  blue: "🔵",
  red: "🔴",
  purple: "🟣",
};
