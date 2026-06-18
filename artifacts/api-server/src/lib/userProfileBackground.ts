/**
 * DB-aware watch-profile background resolution shared by the public profile
 * route (`GET /games/profile`) and the account route (`GET /auth/me`, so the
 * Theme picker can preselect the resolved artwork). Wraps the pure
 * `resolveProfileBackground` with the pass lookup + card-variant lookup.
 *
 * Mapping rule: artwork is only ever *assigned by a redeem card*. When an admin
 * mints a card, the chosen splash artwork is stored on the code
 * (`discount_codes.backgroundVariant`). A redeemed card pass keeps that code in
 * `sourceRef`, so we map the player's active card pass back to the code's stored
 * variant — no hashing, no re-derivation. The most recently redeemed card wins
 * when there are several. Passes with no card — crypto purchases, grants, admin
 * effective-Lifetime — carry no code, so `auto` resolves to the plain default
 * (null) for them.
 */
import { db, passesTable, discountCodesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { isAdminEmail } from "./config";
import {
  resolveProfileBackground,
  coerceBackgroundVariant,
  type BackgroundVariant,
} from "./profileBackground";

export async function resolveUserProfileBackground(args: {
  userId: string;
  email: string | null | undefined;
  profileTheme: string | null | undefined;
}): Promise<BackgroundVariant | null> {
  const passRows = await db
    .select({
      id: passesTable.id,
      source: passesTable.source,
      sourceRef: passesTable.sourceRef,
      startedAt: passesTable.startedAt,
      durationSeconds: passesTable.durationSeconds,
    })
    .from(passesTable)
    .where(eq(passesTable.userId, args.userId));

  const now = Date.now();
  const activePassRows = passRows.filter((p) => {
    if (p.startedAt.getTime() > now) return false;
    if (p.durationSeconds === null) return true; // lifetime
    return p.startedAt.getTime() + p.durationSeconds * 1000 > now;
  });

  const isAdmin = isAdminEmail(args.email ?? "");

  // Artwork is carried by a redeemed *card* — a discount-code pass whose code we
  // stored in `sourceRef`. Map the player's active card passes back to the
  // artwork stored on each code, and pick the most recently redeemed one that
  // carried artwork, so the profile matches the printed card. Passes with no
  // card carry no code; codes minted without artwork carry a null variant.
  const cardPasses = activePassRows
    .filter((p) => p.source === "discount_code" && p.sourceRef)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  let cardVariant: BackgroundVariant | null = null;
  if (cardPasses.length > 0) {
    const codes = cardPasses.map((p) => p.sourceRef as string);
    const codeRows = await db
      .select({
        code: discountCodesTable.code,
        backgroundVariant: discountCodesTable.backgroundVariant,
      })
      .from(discountCodesTable)
      .where(inArray(discountCodesTable.code, codes));
    const variantByCode = new Map(
      codeRows.map((r) => [r.code, coerceBackgroundVariant(r.backgroundVariant)]),
    );
    // cardPasses is newest-first; take the first code that actually has artwork.
    for (const p of cardPasses) {
      const v = variantByCode.get(p.sourceRef as string) ?? null;
      if (v) {
        cardVariant = v;
        break;
      }
    }
  }

  return resolveProfileBackground({
    isPaid: activePassRows.length > 0 || isAdmin,
    theme: args.profileTheme,
    cardVariant,
  });
}

/**
 * Batched form of {@link resolveUserProfileBackground} for resolving many users
 * at once (e.g. the leaderboard ranking). Runs at most one `passes` query and
 * one `discount_codes` query for the whole set, then resolves each user in
 * memory with the IDENTICAL rule as the single-user path — same active-pass
 * filter, same "most recently redeemed card with artwork wins" mapping, same
 * admin effective-paid handling. Returns a Map keyed by userId; users absent
 * from `args` are simply absent from the map.
 */
export async function resolveUserProfileBackgrounds(
  args: Array<{
    userId: string;
    email: string | null | undefined;
    profileTheme: string | null | undefined;
  }>,
): Promise<Map<string, BackgroundVariant | null>> {
  const result = new Map<string, BackgroundVariant | null>();
  if (args.length === 0) return result;

  const userIds = args.map((a) => a.userId);

  // One pass query for all users.
  const passRows = await db
    .select({
      userId: passesTable.userId,
      id: passesTable.id,
      source: passesTable.source,
      sourceRef: passesTable.sourceRef,
      startedAt: passesTable.startedAt,
      durationSeconds: passesTable.durationSeconds,
    })
    .from(passesTable)
    .where(inArray(passesTable.userId, userIds));

  const now = Date.now();
  const isActive = (p: { startedAt: Date; durationSeconds: number | null }) => {
    if (p.startedAt.getTime() > now) return false;
    if (p.durationSeconds === null) return true; // lifetime
    return p.startedAt.getTime() + p.durationSeconds * 1000 > now;
  };

  const activeByUser = new Map<string, typeof passRows>();
  for (const p of passRows) {
    if (!isActive(p)) continue;
    const arr = activeByUser.get(p.userId) ?? [];
    arr.push(p);
    activeByUser.set(p.userId, arr);
  }

  // Collect every card code referenced by an active card pass across all users,
  // then resolve their stored artwork in a single discount-code query.
  const allCodes = new Set<string>();
  for (const rows of activeByUser.values()) {
    for (const p of rows) {
      if (p.source === "discount_code" && p.sourceRef) allCodes.add(p.sourceRef);
    }
  }

  const variantByCode = new Map<string, BackgroundVariant | null>();
  if (allCodes.size > 0) {
    const codeRows = await db
      .select({
        code: discountCodesTable.code,
        backgroundVariant: discountCodesTable.backgroundVariant,
      })
      .from(discountCodesTable)
      .where(inArray(discountCodesTable.code, [...allCodes]));
    for (const r of codeRows) {
      variantByCode.set(r.code, coerceBackgroundVariant(r.backgroundVariant));
    }
  }

  for (const a of args) {
    const activePassRows = activeByUser.get(a.userId) ?? [];
    const isAdmin = isAdminEmail(a.email ?? "");

    // Newest-first card passes; first one carrying artwork wins, matching the
    // single-user path.
    const cardPasses = activePassRows
      .filter((p) => p.source === "discount_code" && p.sourceRef)
      .sort((x, y) => y.startedAt.getTime() - x.startedAt.getTime());

    let cardVariant: BackgroundVariant | null = null;
    for (const p of cardPasses) {
      const v = variantByCode.get(p.sourceRef as string) ?? null;
      if (v) {
        cardVariant = v;
        break;
      }
    }

    result.set(
      a.userId,
      resolveProfileBackground({
        isPaid: activePassRows.length > 0 || isAdmin,
        theme: a.profileTheme,
        cardVariant,
      }),
    );
  }

  return result;
}

/**
 * Resolve a host's *effective* profile theme — the value that gameplay
 * surfaces (the HUD felt) tint through. Mirrors the client's effective-theme
 * rule used on the host's own GameScreen: an explicit Theme override
 * (`shark`/`hustler`/`pool-player`/`none`) pins that value, while "auto"
 * (the default, stored NULL) derives the resolved background from the pass's
 * redeem card. Returns null for "none"/unpaid/no-card so the consumer falls
 * back to the default green felt. Carried to joiners/spectators on the
 * `/games/state` snapshot (`hostTheme`).
 */
export async function resolveUserEffectiveTheme(args: {
  userId: string;
  email: string | null | undefined;
  profileTheme: string | null | undefined;
}): Promise<BackgroundVariant | null> {
  const theme = args.profileTheme ?? "auto";
  if (theme !== "auto") {
    // Explicit override: "none" → plain (null); otherwise the chosen variant.
    return coerceBackgroundVariant(theme);
  }
  // "auto" → derive from the pass's redeem card (same as the watch profile).
  return resolveUserProfileBackground(args);
}
