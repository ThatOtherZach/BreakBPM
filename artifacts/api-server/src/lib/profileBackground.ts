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
 * Free / account / expired-pass users auto-earn a theme when one game mode
 * forms a plurality of their last 10 completed games AND the most recent such
 * game was within the past 10 days. See `computeAutoEarnedVariantFromGames` in
 * `userProfileBackground.ts` for the earn logic.
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
 * plain"; `none` means a plain background. `rainbow` is a name-only flair (a
 * rainbow screen name everywhere the player's name shows) that does NOT pin a
 * felt artwork — the felt stays default/auto-earned, exactly like `auto`. */
export const PROFILE_THEME_VALUES = ["auto", "none", "rainbow", ...BACKGROUND_VARIANTS] as const;
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
 *
 * Paid users (active pass / admin):
 * - Explicit variant override → that variant, permanent while the pass is
 *   active. The 10-day game-history window never overrides a paid manual pick.
 * - `none` → null (plain default background).
 * - `auto` → the artwork stamped on the pass's redeem card (`cardVariant`).
 *
 * Unpaid users (free / account tier, or a user whose pass has since expired):
 * - `earnedVariant` → a variant auto-earned by game-history majority rule,
 *   subject to a 10-day recency window. Returns null when not currently earned.
 *   The stored `profileTheme` preference is ignored for unpaid callers — the
 *   picker is Lifetime/admin-only, so any stored value is stale from a
 *   now-expired pass.
 */
export function resolveProfileBackground(opts: {
  isPaid: boolean;
  theme: string | null | undefined;
  cardVariant: BackgroundVariant | null;
  /** Auto-earned variant from the caller's recent game history (non-paid path). */
  earnedVariant?: BackgroundVariant | null;
}): BackgroundVariant | null {
  if (opts.isPaid) {
    const theme = normalizeProfileTheme(opts.theme);
    if (theme === "none") return null;
    // `rainbow` is a name-only flair and pins no artwork — it falls through to
    // the auto/card resolution like `auto` so the felt stays default/earned.
    if (theme !== "auto" && theme !== "rainbow") return theme;
    return opts.cardVariant;
  }
  // Non-paid (free / account / expired pass): only auto-earned themes apply.
  return opts.earnedVariant ?? null;
}
