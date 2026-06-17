/**
 * DB-aware watch-profile background resolution shared by the public profile
 * route (`GET /games/profile`) and the account route (`GET /auth/me`, so the
 * Theme picker can preselect the resolved artwork). Wraps the pure
 * `resolveProfileBackground` with the pass lookup + derivation-key rule.
 *
 * Derivation rule: artwork is only ever *assigned by a redeem card*. The
 * headline active pass's redeem code (stored in `sourceRef` for discount-code
 * passes) is the derivation key, so the profile matches the printed card.
 * Passes with no card — crypto purchases, grants, admin effective-Lifetime —
 * carry no key, so `auto` resolves to the plain default (null) for them.
 */
import { db, passesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isAdminEmail } from "./config";
import { resolveProfileBackground, type BackgroundVariant } from "./profileBackground";

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

  // Headline pass = latest-expiring (lifetime sorts last); its redeem code is
  // the derivation key when it was redeemed from a card.
  const headlinePass =
    activePassRows.length > 0
      ? activePassRows.reduce((a, b) => {
          const ae = a.durationSeconds === null ? Infinity : a.startedAt.getTime() + a.durationSeconds * 1000;
          const be = b.durationSeconds === null ? Infinity : b.startedAt.getTime() + b.durationSeconds * 1000;
          return be > ae ? b : a;
        })
      : null;
  const deriveKey =
    headlinePass && headlinePass.source === "discount_code" && headlinePass.sourceRef
      ? headlinePass.sourceRef
      : null;

  return resolveProfileBackground({
    isPaid: activePassRows.length > 0 || isAdmin,
    theme: args.profileTheme,
    deriveKey,
  });
}
