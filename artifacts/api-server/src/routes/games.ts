import { Router, type IRouter } from "express";
import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, gamesTable } from "@workspace/db";
import {
  StartGameBody,
  StartGameResponse,
  RecordGameActivityBody,
  RecordGameActivityResponse,
  SaveGameBody,
  SaveGameResponse,
  GetGameHistoryResponse,
  GetResumableGameResponse,
  AbandonGameBody,
  AbandonGameResponse,
} from "@workspace/api-zod";
import { getOrCreateUser, getVerifiedSubject } from "../lib/auth";
import { computeEntitlement } from "../lib/entitlement";
import { sweepStaleGames, INACTIVITY_FORFEIT_MS } from "../lib/forfeit";
import { newId } from "../lib/ids";

const router: IRouter = Router();

/**
 * Hard wall-clock cap for anonymous play. They get unlimited games but
 * each session has to wrap up within an hour — enforced client-side
 * (anonymous play never round-trips after /games/start).
 */
const ANONYMOUS_MAX_GAME_DURATION_MS = 60 * 60 * 1000;

/**
 * Begin a game.
 * - Anonymous: no rate limiting, no DB row, no cooldown — the response
 *   carries `maxGameDurationMs` so the client can self-enforce the
 *   1-hour session cap.
 * - Signed-in: provisions an in-progress row (endedAt = null) so the
 *   server can record activity / forfeit it. Lazily sweeps the user's
 *   stale in-progress games.
 */
router.post("/games/start", async (req, res): Promise<void> => {
  const parsed = StartGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const verified = await getVerifiedSubject(req);

  if (!verified) {
    res.json(
      StartGameResponse.parse({
        allowed: true,
        tier: "public",
        gameId: null,
        inactivityTimeoutMs: INACTIVITY_FORFEIT_MS,
        maxGameDurationMs: ANONYMOUS_MAX_GAME_DURATION_MS,
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
    // Real gameType so the inactivity sweep can exempt practice mode.
    gameType: parsed.data.gameType,
    shareCode: "",            // overwritten on /games/save
    // Seed a minimal snapshot so /games/resume can offer the row from the
    // very first moment, before the client has logged any shots. The
    // client's first /games/activity ping (fired on mount) will replace
    // this with the full state including players + share code.
    gameState: { gameType: parsed.data.gameType, startedAt: new Date().toISOString() },
    startedAt: new Date(),
    lastActivityAt: new Date(),
    endedAt: null,
    outcome: null,
  });
  res.json(
    StartGameResponse.parse({
      allowed: true,
      tier: entitlement.tier,
      gameId: id,
      inactivityTimeoutMs: INACTIVITY_FORFEIT_MS,
      maxGameDurationMs: null,
    }),
  );
});

/**
 * Record a logged in-game action — bumps lastActivityAt for an in-progress
 * game. Called by the client after every sink/miss/foul/safety, NOT on a
 * timer, so the inactivity forfeit reflects gameplay rather than tab
 * liveness. Returns `alive: false` if the row was already finalized.
 */
router.post("/games/activity", async (req, res): Promise<void> => {
  const parsed = RecordGameActivityBody.safeParse(req.body);
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
  // When the client ships a snapshot, persist it on the row so
  // /games/resume can hand back the exact in-progress state on a
  // different device / cleared browser. Omitting the snapshot leaves
  // the previous one intact (don't blank it).
  const setFields: { lastActivityAt: Date; gameState?: Record<string, unknown> } = {
    lastActivityAt: new Date(),
  };
  if (parsed.data.gameState !== undefined && parsed.data.gameState !== null) {
    setFields.gameState = parsed.data.gameState as Record<string, unknown>;
  }
  const updated = await db
    .update(gamesTable)
    .set(setFields)
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
      RecordGameActivityResponse.parse({
        alive: false,
        message: "Game already ended (likely auto-forfeit)",
      }),
    );
    return;
  }
  res.json(RecordGameActivityResponse.parse({ alive: true }));
});

/**
 * Persist a completed game.
 * - Anonymous: no-op. We don't store anonymous play at all.
 * - Signed-in: finalize the in-progress row created at /games/start.
 *   Falls back to a fresh insert if the original row is missing or
 *   already ended.
 */
router.post("/games/save", async (req, res): Promise<void> => {
  const parsed = SaveGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const verified = await getVerifiedSubject(req);

  if (!verified) {
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
 * Most-recent in-progress game for the signed-in caller, if any. Used by
 * the client as a fallback recovery path when localStorage is empty
 * (different device, cleared browser). Sweeps stale rows first so a
 * long-idle game is auto-forfeited rather than offered for resume.
 */
router.get("/games/resume", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.json(GetResumableGameResponse.parse({ resumable: false }));
    return;
  }
  await sweepStaleGames(user.id);
  const rows = await db
    .select()
    .from(gamesTable)
    .where(and(eq(gamesTable.userId, user.id), isNull(gamesTable.endedAt)))
    .orderBy(desc(gamesTable.lastActivityAt))
    .limit(1);
  if (rows.length === 0) {
    res.json(GetResumableGameResponse.parse({ resumable: false }));
    return;
  }
  const row = rows[0];
  res.json(
    GetResumableGameResponse.parse({
      resumable: true,
      game: {
        gameId: row.id,
        gameType: row.gameType,
        startedAt: row.startedAt.toISOString(),
        lastActivityAt: row.lastActivityAt.toISOString(),
        gameState: (row.gameState as unknown) ?? {},
      },
    }),
  );
});

/**
 * Explicitly abandon an in-progress game (the user declined a resume
 * prompt). Marks the row as a forfeit so it doesn't linger.
 */
router.post("/games/abandon", async (req, res): Promise<void> => {
  const parsed = AbandonGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  const updated = await db
    .update(gamesTable)
    .set({ endedAt: new Date(), outcome: "forfeit" })
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
      AbandonGameResponse.parse({
        abandoned: false,
        message: "Game not found or already ended",
      }),
    );
    return;
  }
  req.log.info({ userId: user.id, gameId: parsed.data.gameId }, "Game abandoned");
  res.json(AbandonGameResponse.parse({ abandoned: true }));
});

const HISTORY_PAGE_SIZE_PASS = 10;

/**
 * Game history. Tier gates the *view*, not the storage. Sweeps stale
 * in-progress rows first so they appear with their final forfeit status.
 *
 * Free accounts: always return the 3 most recent games (truncated=true when
 * more exist). Pass holders: paginate at 10 per page via ?page= (1-indexed).
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
        page: 1,
        totalPages: 1,
        games: [],
      }),
    );
    return;
  }
  await sweepStaleGames(user.id);

  const entitlement = await computeEntitlement(user);
  const limit = entitlement.historyVisibleLimit;

  // Count ended games server-side — needed for pagination metadata and the
  // free-tier "upgrade to see all N" CTA regardless of tier.
  const [{ total }] = await db
    .select({ total: count() })
    .from(gamesTable)
    .where(and(eq(gamesTable.userId, user.id), isNotNull(gamesTable.endedAt)));
  const totalCount = total;

  let page: number;
  let totalPages: number;
  let rowLimit: number;
  let offset: number;

  if (limit === null) {
    // Pass holder — paginate at HISTORY_PAGE_SIZE_PASS rows per page.
    const rawPage = parseInt(String(req.query.page ?? "1"), 10);
    totalPages = Math.max(1, Math.ceil(totalCount / HISTORY_PAGE_SIZE_PASS));
    page = Math.min(Math.max(1, isNaN(rawPage) ? 1 : rawPage), totalPages);
    rowLimit = HISTORY_PAGE_SIZE_PASS;
    offset = (page - 1) * HISTORY_PAGE_SIZE_PASS;
  } else {
    // Free account — always first N, no pagination.
    rowLimit = limit;
    offset = 0;
    page = 1;
    totalPages = 1;
  }

  const visible = await db
    .select()
    .from(gamesTable)
    .where(and(eq(gamesTable.userId, user.id), isNotNull(gamesTable.endedAt)))
    .orderBy(desc(gamesTable.endedAt))
    .limit(rowLimit)
    .offset(offset);

  const games = visible.map((g) => {
    const gs = g.gameState as Record<string, unknown> | null;
    return {
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
      sharkMode: !!(gs && gs["sharkAggression"]),
    };
  });

  res.json(
    GetGameHistoryResponse.parse({
      tier: entitlement.tier,
      totalCount,
      visibleCount: games.length,
      truncated: limit !== null && totalCount > games.length,
      page,
      totalPages,
      games,
    }),
  );
});

export default router;
