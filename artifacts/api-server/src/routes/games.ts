import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, gamesTable } from "@workspace/db";
import {
  StartGameBody,
  StartGameResponse,
  SaveGameBody,
  SaveGameResponse,
  GetGameHistoryResponse,
} from "@workspace/api-zod";
import { getOrCreateUser, authProvider } from "../lib/auth";
import { computeEntitlement } from "../lib/entitlement";
import {
  checkPublicFreeCooldown,
  recordPublicFreeGame,
  getRequestIp,
} from "../lib/cooldown";
import { newId } from "../lib/ids";

const router: IRouter = Router();

/**
 * Gate: may the caller start a new game?
 * - Pass tier or signed-in account: always allowed.
 * - Anonymous: allowed if (ip, deviceId) is past its 5-min cooldown. Records
 *   the game on success so the next attempt is rate-limited.
 */
router.post("/games/start", async (req, res): Promise<void> => {
  const parsed = StartGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const identity = await authProvider.getIdentity(req);
  if (identity) {
    const user = await getOrCreateUser(req);
    const entitlement = await computeEntitlement(user);
    res.json(
      StartGameResponse.parse({
        allowed: true,
        tier: entitlement.tier,
        cooldownSecondsRemaining: null,
      }),
    );
    return;
  }

  const ip = getRequestIp(req);
  const status = await checkPublicFreeCooldown(ip, parsed.data.deviceId);
  if (!status.allowed) {
    const remainingSec = Math.ceil(status.remainingMs / 1000);
    res.status(429).json({
      error: "Free game cooldown active. Sign in for unlimited play.",
      cooldownSecondsRemaining: remainingSec,
    });
    return;
  }
  await recordPublicFreeGame(ip, parsed.data.deviceId);
  res.json(
    StartGameResponse.parse({
      allowed: true,
      tier: "public",
      cooldownSecondsRemaining: null,
    }),
  );
});

/**
 * Persist a completed game. Anonymous calls are accepted (and ignored) so
 * the client doesn't need to branch — the response says `saved: false`.
 */
router.post("/games/save", async (req, res): Promise<void> => {
  const parsed = SaveGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.json(
      SaveGameResponse.parse({ saved: false, message: "Anonymous — game not saved" }),
    );
    return;
  }

  const id = newId();
  // Coerce bpm float to int*10
  const bpmInt =
    parsed.data.bpm == null ? null : Math.round(Number(parsed.data.bpm) * 10);

  await db.insert(gamesTable).values({
    id,
    userId: user.id,
    gameType: parsed.data.gameType,
    shareCode: parsed.data.shareCode,
    winner: parsed.data.winner ?? null,
    bpm: bpmInt,
    durationMs: parsed.data.durationMs,
    sunkBallsCount: parsed.data.sunkBallsCount,
    outcome: parsed.data.outcome,
    gameState: parsed.data.gameState,
    startedAt: new Date(parsed.data.startedAt),
    endedAt: new Date(),
  });

  req.log.info({ userId: user.id, gameId: id, outcome: parsed.data.outcome }, "Game saved");
  res.json(SaveGameResponse.parse({ saved: true, gameId: id, message: "Game saved" }));
});

/**
 * Game history. Tier gates the *view*, not the storage — older rows are
 * always retained for free-account users.
 */
router.get("/games/history", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.json(
      GetGameHistoryResponse.parse({
        tier: "public",
        totalCount: 0,
        visibleCount: 0,
        truncated: false,
        games: [],
      }),
    );
    return;
  }

  const entitlement = await computeEntitlement(user);
  const all = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.userId, user.id))
    .orderBy(desc(gamesTable.endedAt));

  const limit = entitlement.historyVisibleLimit;
  const visible = limit === null ? all : all.slice(0, limit);
  const games = visible.map((g) => ({
    id: g.id,
    gameType: g.gameType,
    winner: g.winner,
    bpm: g.bpm == null ? null : g.bpm / 10,
    durationMs: g.durationMs,
    sunkBallsCount: g.sunkBallsCount,
    outcome: g.outcome,
    shareCode: g.shareCode,
    endedAt: g.endedAt,
    startedAt: g.startedAt,
  }));

  res.json(
    GetGameHistoryResponse.parse({
      tier: entitlement.tier,
      totalCount: all.length,
      visibleCount: visible.length,
      truncated: limit !== null && all.length > visible.length,
      games,
    }),
  );
});

// keep a defensive `and` import even if unused later
void and;

export default router;
