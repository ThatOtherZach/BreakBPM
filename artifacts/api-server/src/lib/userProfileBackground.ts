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
