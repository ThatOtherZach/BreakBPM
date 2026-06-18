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
 *
 * Auto-earn rule (non-paid path):
 * The last 10 completed games hosted by the user are classified by mode:
 *   - Shark          → "shark"       (8-ball solo: gameType==="8ball" && maxPlayers===1)
 *   - 8-Ball versus  → "hustler"     (gameType==="8ball" && maxPlayers>1)
 *   - Chaos Practice → "pool-player" (gameType==="practice" && chaosMode!=="none")
 * The mode with the plurality wins. On a tie → null (green). Additionally, the
 * most recent game belonging to the winning mode must have ended within the last
 * 10 days — otherwise the theme lapses and null is returned.
 * Pass holders are entirely exempt from this path; their manual pick (if any)
 * persists for the full life of the pass with no time limit.
 */
import { db, passesTable, discountCodesTable, gamesTable } from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { isAdminEmail } from "./config";
import {
  resolveProfileBackground,
  coerceBackgroundVariant,
  type BackgroundVariant,
} from "./profileBackground";

// ---------------------------------------------------------------------------
// Auto-earn helpers
// ---------------------------------------------------------------------------

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

type ClassifiedGame = {
  gameType: string;
  maxPlayers: number;
  chaosMode: string | null;
  endedAt: Date;
};

function classifyGame(g: ClassifiedGame): BackgroundVariant | null {
  if (g.gameType === "8ball" && g.maxPlayers === 1) return "shark";
  if (g.gameType === "8ball" && g.maxPlayers > 1) return "hustler";
  if (g.gameType === "practice" && g.chaosMode && g.chaosMode !== "none")
    return "pool-player";
  return null;
}

/**
 * Given a pre-fetched slice of up to 10 completed games (newest-first), return
 * the auto-earned BackgroundVariant or null. Pure — no DB access; split out so
 * the batched path can share the logic without re-querying.
 */
export function computeAutoEarnedVariantFromGames(
  games: ClassifiedGame[],
): BackgroundVariant | null {
  if (games.length === 0) return null;

  const now = Date.now();
  const counts = new Map<BackgroundVariant, number>();
  const latestAt = new Map<BackgroundVariant, Date>();

  for (const g of games) {
    const variant = classifyGame(g);
    if (!variant) continue;
    counts.set(variant, (counts.get(variant) ?? 0) + 1);
    const prev = latestAt.get(variant);
    if (!prev || g.endedAt > prev) latestAt.set(variant, g.endedAt);
  }

  if (counts.size === 0) return null;

  let winner: BackgroundVariant | null = null;
  let maxCount = 0;
  let tie = false;
  for (const [variant, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      winner = variant;
      tie = false;
    } else if (count === maxCount) {
      tie = true;
    }
  }

  if (tie || !winner) return null;

  const latest = latestAt.get(winner)!;
  if (latest.getTime() < now - TEN_DAYS_MS) return null;

  return winner;
}

async function computeAutoEarnedVariant(userId: string): Promise<BackgroundVariant | null> {
  const rows = await db
    .select({
      gameType: gamesTable.gameType,
      maxPlayers: gamesTable.maxPlayers,
      endedAt: gamesTable.endedAt,
      chaosMode: sql<string | null>`${gamesTable.gameState}->>'chaosMode'`,
    })
    .from(gamesTable)
    .where(and(eq(gamesTable.userId, userId), isNotNull(gamesTable.endedAt)))
    .orderBy(desc(gamesTable.endedAt))
    .limit(10);

  return computeAutoEarnedVariantFromGames(
    rows.map((r) => ({ ...r, endedAt: r.endedAt as Date })),
  );
}

// ---------------------------------------------------------------------------
// Single-user resolver
// ---------------------------------------------------------------------------

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
  const isPaid = activePassRows.length > 0 || isAdmin;

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
    for (const p of cardPasses) {
      const v = variantByCode.get(p.sourceRef as string) ?? null;
      if (v) {
        cardVariant = v;
        break;
      }
    }
  }

  const earnedVariant = isPaid ? null : await computeAutoEarnedVariant(args.userId);

  return resolveProfileBackground({
    isPaid,
    theme: args.profileTheme,
    cardVariant,
    earnedVariant,
  });
}

// ---------------------------------------------------------------------------
// Batched resolver (leaderboard, etc.)
// ---------------------------------------------------------------------------

/**
 * Batched form of {@link resolveUserProfileBackground} for resolving many users
 * at once (e.g. the leaderboard ranking). Runs at most one `passes` query, one
 * `discount_codes` query, and one `games` query for the whole set, then
 * resolves each user in memory with the IDENTICAL rule as the single-user path.
 * Returns a Map keyed by userId; users absent from `args` are simply absent
 * from the map.
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
    if (p.durationSeconds === null) return true;
    return p.startedAt.getTime() + p.durationSeconds * 1000 > now;
  };

  const activeByUser = new Map<string, typeof passRows>();
  for (const p of passRows) {
    if (!isActive(p)) continue;
    const arr = activeByUser.get(p.userId) ?? [];
    arr.push(p);
    activeByUser.set(p.userId, arr);
  }

  const paidUserIds = new Set<string>();
  for (const a of args) {
    const activePasses = activeByUser.get(a.userId) ?? [];
    if (activePasses.length > 0 || isAdminEmail(a.email ?? "")) {
      paidUserIds.add(a.userId);
    }
  }

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

  const unpaidUserIds = userIds.filter((id) => !paidUserIds.has(id));
  const gamesByUser = new Map<string, ClassifiedGame[]>();
  if (unpaidUserIds.length > 0) {
    const gameRows = await db
      .select({
        userId: gamesTable.userId,
        gameType: gamesTable.gameType,
        maxPlayers: gamesTable.maxPlayers,
        endedAt: gamesTable.endedAt,
        chaosMode: sql<string | null>`${gamesTable.gameState}->>'chaosMode'`,
      })
      .from(gamesTable)
      .where(
        and(inArray(gamesTable.userId, unpaidUserIds), isNotNull(gamesTable.endedAt)),
      )
      .orderBy(desc(gamesTable.endedAt));

    for (const r of gameRows) {
      const arr = gamesByUser.get(r.userId) ?? [];
      if (arr.length < 10) {
        arr.push({ ...r, endedAt: r.endedAt as Date });
        gamesByUser.set(r.userId, arr);
      }
    }
  }

  for (const a of args) {
    const activePassRows = activeByUser.get(a.userId) ?? [];
    const isAdmin = isAdminEmail(a.email ?? "");
    const isPaid = activePassRows.length > 0 || isAdmin;

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

    const earnedVariant = isPaid
      ? null
      : computeAutoEarnedVariantFromGames(gamesByUser.get(a.userId) ?? []);

    result.set(
      a.userId,
      resolveProfileBackground({
        isPaid,
        theme: a.profileTheme,
        cardVariant,
        earnedVariant,
      }),
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Effective-theme resolver (HUD felt, game state snapshot)
// ---------------------------------------------------------------------------

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
    return coerceBackgroundVariant(theme);
  }
  return resolveUserProfileBackground(args);
}
