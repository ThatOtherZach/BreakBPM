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
 * playing mostly one mode in their last 10 completed games within the past 10
 * days. A simple majority (> 50%) of those games must be the same category:
 *   Shark mode        → "shark"       (8-ball solo: gameType==="8ball" && maxPlayers===1)
 *   8-Ball (standard) → "hustler"     (gameType==="8ball" && maxPlayers>1 && no chaos)
 *   Practice / Chaos  → "pool-player" (all practice games; 8-ball with chaosMode set)
 * Additionally, the most recent game in the winning category must have ended
 * within the last 10 days — otherwise the theme lapses and null is returned.
 *
 * Resolution order:
 *   1. Pass holder / admin with an explicit variant theme → that variant (permanent while pass active).
 *   2. Anyone (incl. pass holder with auto/none) → auto-earn helper result.
 *   3. Null → green default.
 */
import { db, passesTable, gamesTable } from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { isAdminEmail } from "./config";
import {
  coerceBackgroundVariant,
  normalizeProfileTheme,
  type BackgroundVariant,
} from "./profileBackground";

// ---------------------------------------------------------------------------
// Auto-earn helpers
// ---------------------------------------------------------------------------

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

export type ClassifiedGame = {
  gameType: string;
  maxPlayers: number;
  chaosMode: string | null;
  endedAt: Date;
};

/**
 * Classify one completed game into the auto-earn bucket that should receive
 * credit. Returns null for game types that don't map to any earneable theme
 * (e.g. 9-ball).
 *
 * - Shark        (8-ball solo, maxPlayers===1) → "shark"
 * - Practice     (all practice games)          → "pool-player"
 * - Chaos 8-ball (chaosMode set / non-null)    → "pool-player"
 * - Standard 8-ball (maxPlayers>1, no chaos)   → "hustler"
 */
function classifyGame(g: ClassifiedGame): BackgroundVariant | null {
  if (g.gameType === "8ball" && g.maxPlayers === 1) return "shark";
  if (g.gameType === "practice") return "pool-player";
  if (g.gameType === "8ball") {
    // Chaos / no-teams formats carry a chaosMode value in gameState; standard
    // team play leaves it absent (null from the SQL extraction).
    if (g.chaosMode !== null) return "pool-player";
    return "hustler";
  }
  return null; // 9-ball and any future types do not earn a theme
}

/**
 * Given a pre-fetched slice of up to 10 completed games (newest-first), return
 * the auto-earned BackgroundVariant or null. Pure — no DB access; split out so
 * the batched path can share the logic without re-querying.
 *
 * Rules:
 * - One category must hold a **simple majority** (strictly more than 50%).
 * - The most recent game belonging to the winning category must have ended
 *   within the last 10 days (freshness scoped to the winning mode — a stale
 *   dominant mode is not rescued by recent games in other modes).
 * - Ties → null (green default).
 */
export function computeAutoEarnedVariantFromGames(
  games: ClassifiedGame[],
): BackgroundVariant | null {
  if (games.length === 0) return null;

  const now = Date.now();
  const counts = new Map<BackgroundVariant, number>();
  // Rows are newest-first; the first game seen per category is its most recent.
  const latestAt = new Map<BackgroundVariant, Date>();

  for (const g of games) {
    const variant = classifyGame(g);
    if (!variant) continue;
    counts.set(variant, (counts.get(variant) ?? 0) + 1);
    if (!latestAt.has(variant)) latestAt.set(variant, g.endedAt);
  }

  if (counts.size === 0) return null;

  const total = games.length;
  // Simple majority: strictly more than half of the qualifying set.
  let winner: BackgroundVariant | null = null;
  for (const [variant, count] of counts) {
    if (count * 2 > total) {
      winner = variant;
      break;
    }
  }
  if (!winner) return null;

  // Freshness gate: the most recent game in the winning category must be recent.
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
// Single-user resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the background for a single user.
 *
 * Resolution order:
 *   1. Active pass holder / admin with an explicit variant theme → return it directly
 *      (no time limit; persists for the life of the pass / admin status).
 *   2. Fall through to auto-earn (applies to everyone: free, account, pass-with-auto/none).
 *   3. Null → caller renders the default green felt.
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

  // Path 1: paid user with an explicit variant override → honour it permanently
  // (while the pass is active / while they remain an admin). Paid users with
  // auto/none fall through to auto-earn below, same as everyone else.
  if (isPaid) {
    const theme = normalizeProfileTheme(args.profileTheme);
    if (theme !== "auto" && theme !== "none") {
      const explicit = coerceBackgroundVariant(theme);
      if (explicit) return explicit;
    }
  }

  // Path 2: auto-earn (applies to everyone — free, account, or paid-with-no-explicit-pick).
  return computeAutoEarnedVariant(args.userId);
}

// ---------------------------------------------------------------------------
// Batched resolver (leaderboard, etc.)
// ---------------------------------------------------------------------------

/**
 * Batched form of {@link resolveUserProfileBackground} for resolving many users
 * at once (e.g. the leaderboard ranking). Runs at most one `passes` query and
 * one `games` query for the whole set, then resolves each user in memory with
 * the IDENTICAL rule as the single-user path — same active-pass filter, same
 * explicit-theme check for paid users, same auto-earn majority/freshness logic.
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

  const activeByUser = new Map<string, PassRow[]>();
  for (const p of passRows) {
    if (!isActivePass(p, now)) continue;
    const arr = activeByUser.get(p.userId) ?? [];
    arr.push(p);
    activeByUser.set(p.userId, arr);
  }

  // Fetch last-10 completed games for ALL users — paid users with auto/none also
  // fall through to auto-earn, so we can't skip them.
  const gameRows = await db
    .select({
      userId: gamesTable.userId,
      gameType: gamesTable.gameType,
      maxPlayers: gamesTable.maxPlayers,
      endedAt: gamesTable.endedAt,
      chaosMode: sql<string | null>`${gamesTable.gameState}->>'chaosMode'`,
    })
    .from(gamesTable)
    .where(and(inArray(gamesTable.userId, userIds), isNotNull(gamesTable.endedAt)))
    .orderBy(desc(gamesTable.endedAt));

  // Bucket games by user, keeping only the 10 most recent per user.
  const gamesByUser = new Map<string, ClassifiedGame[]>();
  for (const r of gameRows) {
    const arr = gamesByUser.get(r.userId) ?? [];
    if (arr.length < 10) {
      arr.push({ ...r, endedAt: r.endedAt as Date });
      gamesByUser.set(r.userId, arr);
    }
  }

  for (const a of args) {
    const activePassRows = activeByUser.get(a.userId) ?? [];
    const isAdmin = isAdminEmail(a.email ?? "");
    const isPaid = activePassRows.length > 0 || isAdmin;

    // Path 1: paid user with an explicit variant override.
    if (isPaid) {
      const theme = normalizeProfileTheme(a.profileTheme);
      if (theme !== "auto" && theme !== "none") {
        const explicit = coerceBackgroundVariant(theme);
        if (explicit) {
          result.set(a.userId, explicit);
          continue;
        }
      }
    }

    // Path 2: auto-earn.
    result.set(a.userId, computeAutoEarnedVariantFromGames(gamesByUser.get(a.userId) ?? []));
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
  if (theme !== "auto") {
    // Explicit override: "none" → plain (null); otherwise the chosen variant.
    return coerceBackgroundVariant(theme);
  }
  // "auto" → use the full profile resolver (auto-earn, or explicit-theme if paid).
  return resolveUserProfileBackground(args);
}
