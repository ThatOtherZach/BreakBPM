/**
 * Pass-themed watch-profile background resolution.
 *
 * A paid player's public /watch/{name} profile wears one of three splash
 * artworks. The artwork is CHOSEN AND STORED when an admin mints the redeem
 * card (see `discount_codes.backgroundVariant`) and mapped to whoever redeems
 * that code — it is never derived from the code string. Lifetime holders (and
 * admins, who are effective Lifetime) can override the artwork via a stored
 * Theme preference.
 *
 * LOCKSTEP: `BACKGROUND_VARIANTS` order is mirrored client-side in
 * `artifacts/breakbpm/src/lib/backgroundVariants.ts`; both must list the same
 * variant ids so the redeem card and the server-resolved profile reference the
 * same artwork. The resolution is pinned by `profileBackground.test.ts`.
 */
import { randomInt } from "crypto";

export const BACKGROUND_VARIANTS = ["shark", "pool-player", "hustler"] as const;
export type BackgroundVariant = (typeof BACKGROUND_VARIANTS)[number];

/** Stored profile-theme preference values. `auto` (or NULL in the DB) means
 * "use the artwork stamped on my pass's redeem card when it carried one, else
 * plain"; `none` means a plain background. */
export const PROFILE_THEME_VALUES = ["auto", "none", ...BACKGROUND_VARIANTS] as const;
export type ProfileTheme = (typeof PROFILE_THEME_VALUES)[number];

/** Pick a random splash artwork. Used when an admin mints a card with artwork
 * enabled — the chosen variant is stored on the code, not recomputed later. */
export function randomBackgroundVariant(): BackgroundVariant {
  return BACKGROUND_VARIANTS[randomInt(BACKGROUND_VARIANTS.length)];
}

/** Coerce a raw stored variant (column value, possibly NULL/garbage) to a
 * known BackgroundVariant, or null when absent/unrecognized. */
export function coerceBackgroundVariant(
  raw: string | null | undefined,
): BackgroundVariant | null {
  if (raw && (BACKGROUND_VARIANTS as readonly string[]).includes(raw)) {
    return raw as BackgroundVariant;
  }
  return null;
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
 * - `auto` → the artwork stored on the pass's redeem card (`cardVariant`). When
 *   the pass carried no card, or the card had no artwork (crypto / grant /
 *   admin / artwork-disabled), `cardVariant` is null and `auto` falls back to
 *   the plain default (null), so artwork is only ever assigned by a card.
 */
export function resolveProfileBackground(opts: {
  isPaid: boolean;
  theme: string | null | undefined;
  cardVariant: BackgroundVariant | null;
}): BackgroundVariant | null {
  if (!opts.isPaid) return null;
  const theme = normalizeProfileTheme(opts.theme);
  if (theme === "none") return null;
  if (theme !== "auto") return theme;
  return opts.cardVariant;
}
