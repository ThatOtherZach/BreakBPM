import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, gamesTable } from "@workspace/db";
import {
  StartGameBody,
  StartGameResponse,
  HeartbeatGameBody,
  HeartbeatGameResponse,
  SaveGameBody,
  SaveGameResponse,
  GetGameHistoryResponse,
} from "@workspace/api-zod";
import { getOrCreateUser, getVerifiedSubject } from "../lib/auth";
import { computeEntitlement } from "../lib/entitlement";
import {
  checkPublicFreeCooldown,
  recordPublicFreeGameEnd,
  getRequestIp,
} from "../lib/cooldown";
import { sweepStaleGames, INACTIVITY_FORFEIT_MS } from "../lib/forfeit";
import { newId } from "../lib/ids";

const router: IRouter = Router();

/**
 * Begin a game.
 * - Public tier: cooldown is *checked* here, not recorded — recording happens
 *   at /games/save so the user only burns their free game on completion.
 * - Signed-in tier: provisions an in-progress row (endedAt = null) so the
 *   server can heartbeat / forfeit it. Anonymous users don't get a row.
 *
 * Also lazily sweeps the user's stale in-progress games (60min inactive →
 * auto-forfeit) so reconciliation doesn't need a background job.
 */
router.post("/games/start", async (req, res): Promise<void> => {
  const parsed = StartGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const verified = await getVerifiedSubject(req);

  if (!verified) {
    // Anonymous flow: just check cooldown.
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
    res.json(
      StartGameResponse.parse({
        allowed: true,
        tier: "public",
        cooldownSecondsRemaining: null,
        gameId: null,
        inactivityTimeoutMs: INACTIVITY_FORFEIT_MS,
      }),
    );
    return;
  }

  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(500).json({ error: "Failed to provision user" });
    return;
  }
  const swept = await sweepStaleGames(user.id);
  if (swept > 0) req.log.info({ userId: user.id, swept }, "Auto-forfeited stale games");

  const entitlement = await computeEntitlement(user);
  const id = newId();
  await db.insert(gamesTable).values({
    id,
    userId: user.id,
    gameType: "8ball",        // overwritten on /games/save
    shareCode: "",            // overwritten on /games/save
    gameState: {},
    startedAt: new Date(),
    lastActivityAt: new Date(),
    endedAt: null,
    outcome: null,
  });
  res.json(
    StartGameResponse.parse({
      allowed: true,
      tier: entitlement.tier,
      cooldownSecondsRemaining: null,
      gameId: id,
      inactivityTimeoutMs: INACTIVITY_FORFEIT_MS,
    }),
  );
});

/**
 * Heartbeat — bump lastActivityAt for an in-progress game. Returns
 * `alive: false` if the game was already finalized (typically by the
 * forfeit sweep) so the client can stop pinging and surface the result.
 */
router.post("/games/heartbeat", async (req, res): Promise<void> => {
  const parsed = HeartbeatGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  await sweepStaleGames(user.id);
  const updated = await db
    .update(gamesTable)
    .set({ lastActivityAt: new Date() })
    .where(
      and(
        eq(gamesTable.id, parsed.data.gameId),
        eq(gamesTable.userId, user.id),
        isNull(gamesTable.endedAt),
      ),
    )
    .returning({ id: gamesTable.id });
  if (updated.length === 0) {
    res.json(
      HeartbeatGameResponse.parse({
        alive: false,
        message: "Game already ended (likely auto-forfeit)",
      }),
    );
    return;
  }
  res.json(HeartbeatGameResponse.parse({ alive: true }));
});

/**
 * Persist a completed game.
 * - Anonymous: ignored for storage, but RECORDS the public-free cooldown
 *   here (game-end timing, per the spec).
 * - Signed-in: finalizes the in-progress row created at /games/start. If no
 *   gameId is supplied or the row already ended, falls back to a fresh insert.
 */
router.post("/games/save", async (req, res): Promise<void> => {
  const parsed = SaveGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const verified = await getVerifiedSubject(req);

  if (!verified) {
    // Game-end is when the public cooldown clock starts.
    const ip = getRequestIp(req);
    await recordPublicFreeGameEnd(ip, parsed.data.deviceId);
    res.json(
      SaveGameResponse.parse({ saved: false, message: "Anonymous — game not saved" }),
    );
    return;
  }

  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(500).json({ error: "Failed to provision user" });
    return;
  }

  const bpmInt =
    parsed.data.bpm == null ? null : Math.round(Number(parsed.data.bpm) * 10);

  const fields = {
    gameType: parsed.data.gameType,
    shareCode: parsed.data.shareCode,
    winner: parsed.data.winner ?? null,
    bpm: bpmInt,
    durationMs: parsed.data.durationMs,
    sunkBallsCount: parsed.data.sunkBallsCount,
    outcome: parsed.data.outcome,
    gameState: parsed.data.gameState,
    startedAt: new Date(parsed.data.startedAt),
    lastActivityAt: new Date(),
    endedAt: new Date(),
  };

  let id = parsed.data.gameId ?? null;
  if (id) {
    const updated = await db
      .update(gamesTable)
      .set(fields)
      .where(
        and(
          eq(gamesTable.id, id),
          eq(gamesTable.userId, user.id),
          isNull(gamesTable.endedAt),
        ),
      )
      .returning({ id: gamesTable.id });
    if (updated.length === 0) id = null; // already-ended row → insert a fresh one
  }
  if (!id) {
    id = newId();
    await db.insert(gamesTable).values({ id, userId: user.id, ...fields });
  }

  req.log.info({ userId: user.id, gameId: id, outcome: parsed.data.outcome }, "Game saved");
  res.json(SaveGameResponse.parse({ saved: true, gameId: id, message: "Game saved" }));
});

/**
 * Game history. Tier gates the *view*, not the storage. Sweeps stale
 * in-progress rows first so they appear with their final forfeit status.
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
  await sweepStaleGames(user.id);

  const entitlement = await computeEntitlement(user);
  // Only ended games show up in history.
  const all = await db
    .select()
    .from(gamesTable)
    .where(and(eq(gamesTable.userId, user.id)))
    .orderBy(desc(gamesTable.endedAt));
  const ended = all.filter((g) => g.endedAt !== null);

  const limit = entitlement.historyVisibleLimit;
  const visible = limit === null ? ended : ended.slice(0, limit);
  const games = visible.map((g) => ({
    id: g.id,
    gameType: g.gameType,
    winner: g.winner,
    bpm: g.bpm == null ? null : g.bpm / 10,
    durationMs: g.durationMs,
    sunkBallsCount: g.sunkBallsCount,
    outcome: g.outcome ?? "completed",
    shareCode: g.shareCode,
    endedAt: g.endedAt!,
    startedAt: g.startedAt,
  }));

  res.json(
    GetGameHistoryResponse.parse({
      tier: entitlement.tier,
      totalCount: ended.length,
      visibleCount: visible.length,
      truncated: limit !== null && ended.length > visible.length,
      games,
    }),
  );
});

export default router;
