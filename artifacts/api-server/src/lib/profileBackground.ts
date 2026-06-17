/**
 * Pass-themed watch-profile background resolution.
 *
 * A paid player's public /watch/{name} profile wears one of three splash
 * artworks, derived deterministically from their pass so it matches the redeem
 * card they were given. Lifetime holders (and admins, who are effective
 * Lifetime) can override the artwork via a stored Theme preference.
 *
 * LOCKSTEP: `BACKGROUND_VARIANTS` order AND `backgroundVariantForKey` are
 * mirrored client-side in `artifacts/breakbpm/src/lib/backgroundVariants.ts`.
 * Both must stay identical or the redeem card (client-drawn) and this server
 * resolver will pick different artwork for the same pass. The picker mapping is
 * pinned by `profileBackground.test.ts` and `redeemCard.test.ts`.
 */
export const BACKGROUND_VARIANTS = ["shark", "pool-player", "hustler"] as const;
export type BackgroundVariant = (typeof BACKGROUND_VARIANTS)[number];

/** Stored profile-theme preference values. `auto` (or NULL in the DB) means
 * "derive from my pass"; `none` means a plain background. */
export const PROFILE_THEME_VALUES = ["auto", "none", ...BACKGROUND_VARIANTS] as const;
export type ProfileTheme = (typeof PROFILE_THEME_VALUES)[number];

/**
 * Deterministically pick a background variant for an arbitrary string key
 * (a redeem code, a pass id, etc.). Pure djb2 over the upper-cased, trimmed
 * key — identical to the client picker so the same key always yields the same
 * artwork on both sides.
 */
export function backgroundVariantForKey(key: string): BackgroundVariant {
  const norm = key.trim().toUpperCase();
  let h = 5381;
  for (let i = 0; i < norm.length; i++) {
    h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;
  }
  return BACKGROUND_VARIANTS[h % BACKGROUND_VARIANTS.length];
}

/** Coerce a raw stored theme (column value, possibly NULL/garbage) to a known
 * ProfileTheme; unknown values fall back to `auto`. */
export function normalizeProfileTheme(raw: string | null | undefined): ProfileTheme {
  if (raw && (PROFILE_THEME_VALUES as readonly string[]).includes(raw)) {
    return raw as ProfileTheme;
  }
  return "auto";
}

/**
 * Resolve the background a profile should display.
 * - Unpaid players never get a themed background (null).
 * - `none` → null (plain default background).
 * - An explicit variant override → that variant.
 * - `auto` → deterministic pick from the derivation key (redeem code / pass id).
 */
export function resolveProfileBackground(opts: {
  isPaid: boolean;
  theme: string | null | undefined;
  deriveKey: string;
}): BackgroundVariant | null {
  if (!opts.isPaid) return null;
  const theme = normalizeProfileTheme(opts.theme);
  if (theme === "none") return null;
  if (theme !== "auto") return theme;
  return backgroundVariantForKey(opts.deriveKey);
}
