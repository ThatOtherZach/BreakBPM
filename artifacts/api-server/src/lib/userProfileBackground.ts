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
 * effective-Lifetime — carry no code, so `auto` falls through to the auto-earn
 * path.
 *
 * Auto-earn: any user (including free/account) can earn a themed profile by
 * playing in their recent completed game history. "Their" games are every
 * completed game they were a registered participant in — games they HOSTED and
 * games they JOINED — keyed on their own per-game display name (not the host's):
 *
 *   Practice / Chaos  → "pool-player" (all practice games; 8-ball with chaosMode set)
 *                       Earn: simple majority (> 50%) of the last 10 completed games
 *                       are Practice/Chaos, and the most recent such game was within 30 days.
 *
 *   Shark mode        → "shark"       (8-ball solo: gameType==="8ball" && maxPlayers===1)
 *                       Earn: at least 5 wins in Shark mode across the last 50 completed
 *                       games, with the most recent win within 30 days.
 *                       A "win" means the player's own display name matches the stored
 *                       winner (i.e. they beat the 🦈 Shark AI).
 *
 *   8-Ball (standard) → "hustler"     (gameType==="8ball" && maxPlayers>1 && no chaos)
 *   9-ball            → "hustler"     (any 9-ball game — same competitive bucket)
 *                       Earn: at least 10 wins across standard 8-ball + 9-ball combined,
 *                       across the last 50 completed games, with the most recent win
 *                       within 30 days. A "win" means the player's own display name
 *                       matches the stored winner (whether they hosted or joined).
 *
 * Pool-player majority is checked first. Shark (5 wins) is checked second.
 * Hustler (10 wins) is the final fallback.
 *
 * Resolution order:
 *   1. Pass holder / admin with an explicit variant theme → return it directly
 *      (no time limit; persists for the life of the pass / admin status).
 *   2. Paid with auto/NULL → the artwork stamped on their active redeem card.
 *   3. Fall through to auto-earn (applies to everyone: free, account, or paid
 *      with no explicit pick and no card).
 *   4. Null → caller renders the default green felt.
 */
import {
  db,
  passesTable,
  gamesTable,
  gameParticipantsTable,
  discountCodesTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { isAdminEmail } from "./config";
import {
  coerceBackgroundVariant,
  resolveProfileBackground,
  type BackgroundVariant,
} from "./profileBackground";

// ---------------------------------------------------------------------------
// Auto-earn helpers
// ---------------------------------------------------------------------------

const EARN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type ClassifiedGame = {
  gameType: string;
  maxPlayers: number;
  chaosMode: string | null;
  endedAt: Date;
  /** The winner's display name as stored on the games row (null if no winner). */
  winner: string | null;
  /** The subject player's own display name from their game_participants row —
   * the player whose theme we're computing, whether they hosted or joined
   * (null if the row is absent). */
  subjectDisplayName: string | null;
};

/**
 * Classify one completed game into the auto-earn bucket that should receive
 * credit. Returns null for game types that don't map to any earnable theme.
 *
 * - Shark        (8-ball solo, maxPlayers===1) → "shark"
 * - Practice     (all practice games)          → "pool-player"
 * - Chaos 8-ball (chaosMode set / non-null)    → "pool-player"
 * - Standard 8-ball (maxPlayers>1, no chaos)   → "hustler"
 * - 9-ball (any)                               → "hustler" (same competitive bucket)
 */
function classifyGame(g: ClassifiedGame): BackgroundVariant | null {
  if (g.gameType === "8ball" && g.maxPlayers === 1) return "shark";
  if (g.gameType === "practice") return "pool-player";
  if (g.gameType === "8ball") {
    if (g.chaosMode !== null) return "pool-player";
    return "hustler";
  }
  if (g.gameType === "9ball") return "hustler";
  return null; // any future unrecognised types do not earn a theme
}

/**
 * Given a pre-fetched slice of up to 50 completed games (newest-first), return
 * the auto-earned BackgroundVariant or null. Pure — no DB access; split out so
 * the batched path can share the logic without re-querying. Host/joiner-agnostic:
 * `subjectDisplayName` is the player's own per-game name, so the caller decides
 * whether each game was hosted or joined.
 *
 * Pool-player rule (checked first):
 * - Practice/Chaos games must hold a **simple majority** (strictly > 50%)
 *   of the first 10 games in the slice.
 * - The most recent pool-player game must have ended within the last 30 days.
 *
 * Shark rule (checked second):
 * - At least 5 Shark-mode **wins** (winner === subjectDisplayName) across all
 *   games in the slice (up to 50).
 * - The most recent win must have ended within the last 30 days.
 *
 * Hustler rule (final fallback):
 * - At least 10 standard-8-ball **wins** (winner === subjectDisplayName) across
 *   all games in the slice (up to 50).
 * - The most recent win must have ended within the last 30 days.
 */
export function computeAutoEarnedVariantFromGames(
  games: ClassifiedGame[],
): BackgroundVariant | null {
  if (games.length === 0) return null;

  const now = Date.now();

  // --- Pool-player: majority of the first 10 completed games ---
  // Shark and hustler are excluded from this path; both earn via win-count below.
  const first10 = games.slice(0, 10);
  const counts = new Map<BackgroundVariant, number>();
  // Rows are newest-first; the first entry per category is the most recent.
  const latestAt = new Map<BackgroundVariant, Date>();

  for (const g of first10) {
    const variant = classifyGame(g);
    if (variant !== "pool-player") continue;
    counts.set(variant, (counts.get(variant) ?? 0) + 1);
    if (!latestAt.has(variant)) latestAt.set(variant, g.endedAt);
  }

  const total = first10.length;
  for (const [variant, count] of counts) {
    if (count * 2 > total) {
      const latest = latestAt.get(variant)!;
      if (latest.getTime() >= now - EARN_WINDOW_MS) return variant;
    }
  }

  // --- Shark: 5 wins in Shark mode (across up to 50 games) ---
  // A "win" means the player beat the 🦈 Shark AI: winner === subjectDisplayName.
  let sharkWins = 0;
  let mostRecentSharkWin: Date | null = null;
  for (const g of games) {
    if (classifyGame(g) !== "shark") continue;
    if (
      g.winner !== null &&
      g.subjectDisplayName !== null &&
      g.winner === g.subjectDisplayName
    ) {
      sharkWins++;
      if (mostRecentSharkWin === null) mostRecentSharkWin = g.endedAt; // newest-first
    }
  }
  if (
    sharkWins >= 5 &&
    mostRecentSharkWin !== null &&
    mostRecentSharkWin.getTime() >= now - EARN_WINDOW_MS
  ) {
    return "shark";
  }

  // --- Hustler: 10 wins in standard 8-ball (across up to 50 games) ---
  let hustlerWins = 0;
  let mostRecentHustlerWin: Date | null = null;
  for (const g of games) {
    if (classifyGame(g) !== "hustler") continue;
    if (
      g.winner !== null &&
      g.subjectDisplayName !== null &&
      g.winner === g.subjectDisplayName
    ) {
      hustlerWins++;
      if (mostRecentHustlerWin === null) mostRecentHustlerWin = g.endedAt; // newest-first
    }
  }
  if (
    hustlerWins >= 10 &&
    mostRecentHustlerWin !== null &&
    mostRecentHustlerWin.getTime() >= now - EARN_WINDOW_MS
  ) {
    return "hustler";
  }

  return null;
}

async function computeAutoEarnedVariant(userId: string): Promise<BackgroundVariant | null> {
  // Count every completed game the user was a registered participant in — games
  // they HOSTED and games they JOINED — keyed on their own per-game display name.
  const rows = await db
    .select({
      gameType: gamesTable.gameType,
      maxPlayers: gamesTable.maxPlayers,
      endedAt: gamesTable.endedAt,
      chaosMode: sql<string | null>`${gamesTable.gameState}->>'chaosMode'`,
      winner: gamesTable.winner,
      subjectDisplayName: gameParticipantsTable.displayName,
    })
    .from(gameParticipantsTable)
    .innerJoin(gamesTable, eq(gamesTable.id, gameParticipantsTable.gameId))
    .where(
      and(
        eq(gameParticipantsTable.userId, userId),
        isNotNull(gamesTable.endedAt),
      ),
    )
    .orderBy(desc(gamesTable.endedAt))
    .limit(50);

  return computeAutoEarnedVariantFromGames(
    rows.map((r) => ({ ...r, endedAt: r.endedAt as Date })),
  );
}

// ---------------------------------------------------------------------------
// Pass helpers
// ---------------------------------------------------------------------------

type PassRow = {
  id: string;
  source: string;
  sourceRef: string | null;
  startedAt: Date;
  durationSeconds: number | null;
};

function isActivePass(p: { startedAt: Date; durationSeconds: number | null }, now: number): boolean {
  if (p.startedAt.getTime() > now) return false;
  if (p.durationSeconds === null) return true; // lifetime
  return p.startedAt.getTime() + p.durationSeconds * 1000 > now;
}

// ---------------------------------------------------------------------------
// Card-artwork helpers
// ---------------------------------------------------------------------------

type CardPass = { source: string; sourceRef: string | null; startedAt: Date };

/**
 * Pick the splash artwork a set of active passes earns from their redeem cards.
 * Only `discount_code`-sourced passes carry a card; the artwork is stored on the
 * code at mint time and mapped back via `sourceRef`. The most recently redeemed
 * card with a stored (non-null) variant wins. Pure — `variantByCode` must
 * already map each card's `code` to its coerced variant.
 */
function resolveCardVariantFromMap(
  activePasses: CardPass[],
  variantByCode: Map<string, BackgroundVariant | null>,
): BackgroundVariant | null {
  const cardPasses = activePasses
    .filter((p) => p.source === "discount_code" && p.sourceRef)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  for (const p of cardPasses) {
    const v = variantByCode.get(p.sourceRef as string) ?? null;
    if (v) return v;
  }
  return null;
}

/**
 * Single-user form of {@link resolveCardVariantFromMap}: queries `discount_codes`
 * for just this user's active card passes, then resolves in memory.
 */
async function resolveCardVariant(activePasses: CardPass[]): Promise<BackgroundVariant | null> {
  const codes = activePasses
    .filter((p) => p.source === "discount_code" && p.sourceRef)
    .map((p) => p.sourceRef as string);
  if (codes.length === 0) return null;

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
  return resolveCardVariantFromMap(activePasses, variantByCode);
}

// ---------------------------------------------------------------------------
// Single-user resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the background for a single user.
 *
 * Resolution order:
 *   1. Active pass holder / admin with an explicit variant theme → return it directly
 *      (no time limit; persists for the life of the pass / admin status).
 *   2. Paid with auto/NULL → the artwork stamped on their active redeem card.
 *   3. Fall through to auto-earn (everyone: free, account, or paid with no card).
 *   4. Null → caller renders the default green felt.
 */
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
  const activePassRows = passRows.filter((p) => isActivePass(p, now));
  const isAdmin = isAdminEmail(args.email ?? "");
  const isPaid = activePassRows.length > 0 || isAdmin;

  // Paid users may wear the artwork stamped on their active redeem card; everyone
  // (free, account, or paid-without-a-card) can fall back to a theme auto-earned
  // from recent game history. `resolveProfileBackground` applies the precedence:
  // explicit theme → `none` opt-out → card artwork → auto-earn → plain.
  const cardVariant = isPaid ? await resolveCardVariant(activePassRows) : null;
  const earnedVariant = await computeAutoEarnedVariant(args.userId);

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
 * `discount_codes` query, and one `games` query for the whole set, then resolves
 * each user in memory with the IDENTICAL rule as the single-user path — same
 * active-pass filter, same card-artwork lookup, same auto-earn majority/freshness
 * logic. Returns a Map keyed by userId; users absent from `args` are simply
 * absent from the map.
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

  const activeByUser = new Map<string, PassRow[]>();
  for (const p of passRows) {
    if (!isActivePass(p, now)) continue;
    const arr = activeByUser.get(p.userId) ?? [];
    arr.push(p);
    activeByUser.set(p.userId, arr);
  }

  // One discount_codes query for every active card pass in the set — map each
  // code to its stored artwork variant so the per-user loop stays in-memory.
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

  // Fetch completed games for ALL users — counting games each user HOSTED or
  // JOINED (keyed on their own participant row), so a registered joiner's wins
  // accrue too. Paid users without a card also fall through to auto-earn, so we
  // can't skip them.
  const gameRows = await db
    .select({
      userId: gameParticipantsTable.userId,
      gameType: gamesTable.gameType,
      maxPlayers: gamesTable.maxPlayers,
      endedAt: gamesTable.endedAt,
      chaosMode: sql<string | null>`${gamesTable.gameState}->>'chaosMode'`,
      winner: gamesTable.winner,
      subjectDisplayName: gameParticipantsTable.displayName,
    })
    .from(gameParticipantsTable)
    .innerJoin(gamesTable, eq(gamesTable.id, gameParticipantsTable.gameId))
    .where(
      and(
        inArray(gameParticipantsTable.userId, userIds),
        isNotNull(gamesTable.endedAt),
      ),
    )
    .orderBy(desc(gamesTable.endedAt));

  // Bucket games by the participating user, keeping only the 50 most recent each.
  const gamesByUser = new Map<string, ClassifiedGame[]>();
  for (const r of gameRows) {
    if (r.userId === null) continue; // guests never earn a theme
    const arr = gamesByUser.get(r.userId) ?? [];
    if (arr.length < 50) {
      arr.push({ ...r, endedAt: r.endedAt as Date });
      gamesByUser.set(r.userId, arr);
    }
  }

  for (const a of args) {
    const activePassRows = activeByUser.get(a.userId) ?? [];
    const isAdmin = isAdminEmail(a.email ?? "");
    const isPaid = activePassRows.length > 0 || isAdmin;

    const cardVariant = isPaid
      ? resolveCardVariantFromMap(activePassRows, variantByCode)
      : null;
    const earnedVariant = computeAutoEarnedVariantFromGames(gamesByUser.get(a.userId) ?? []);

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
 * (the default, stored NULL) derives the resolved background via the normal
 * profile resolver (which now includes auto-earn). Returns null for
 * "none"/no-earned-theme so the consumer falls back to the default green felt.
 * Carried to joiners/spectators on the `/games/state` snapshot (`hostTheme`).
 */
export async function resolveUserEffectiveTheme(args: {
  userId: string;
  email: string | null | undefined;
  profileTheme: string | null | undefined;
}): Promise<BackgroundVariant | null> {
  const theme = args.profileTheme ?? "auto";
  if (theme !== "auto" && theme !== "rainbow") {
    // Explicit override: "none" → plain (null); otherwise the chosen variant.
    return coerceBackgroundVariant(theme);
  }
  // "auto"/"rainbow" → use the full profile resolver (auto-earn, or
  // explicit-theme if paid). "rainbow" is a name-only flair: the felt still
  // falls through to the auto-earned variant rather than pinning one.
  return resolveUserProfileBackground(args);
}
