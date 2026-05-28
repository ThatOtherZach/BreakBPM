import { Router, type IRouter } from "express";
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, gamesTable, gameParticipantsTable } from "@workspace/db";
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
  ResolveShareCodeBody,
  ResolveShareCodeResponse,
  JoinGameBody,
  JoinGameResponse,
  LeaveGameBody,
  LeaveGameResponse,
  GetGameStateByCodeQueryParams,
  GetGameStateByCodeResponse,
} from "@workspace/api-zod";
import { getOrCreateUser, getVerifiedSubject } from "../lib/auth";
import { computeEntitlement } from "../lib/entitlement";
import { sweepStaleGames, INACTIVITY_FORFEIT_MS, MAX_GAME_DURATION_MS } from "../lib/forfeit";
import { newId } from "../lib/ids";
import { generateUniqueShareCode, normalizeShareCode } from "../lib/shareCode";

const router: IRouter = Router();

/** Hard wall-clock cap for anonymous play (no DB row, self-enforced client-side). */
const ANONYMOUS_MAX_GAME_DURATION_MS = MAX_GAME_DURATION_MS;

/** Default slot counts by game type. 8-ball can be 2 or 4 players (set via body). */
function defaultMaxPlayers(gameType: string, requested?: number | null): number {
  if (gameType === "practice") return 1;
  if (gameType === "8ball") {
    if (requested === 1 || requested === 2 || requested === 4) return requested;
    return 2;
  }
  if (gameType === "9ball") {
    if (requested === 2 || requested === 4) return requested;
    return 2;
  }
  return 1;
}

function isSoloMode(gameType: string, maxPlayers: number): boolean {
  return gameType === "practice" || (gameType === "8ball" && maxPlayers === 1);
}

/**
 * Resolve any current participant (host or joiner, not left). Used to
 * authorize activity/save/state writes on a game.
 */
async function isParticipantOf(gameId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ slotIndex: gameParticipantsTable.slotIndex })
    .from(gameParticipantsTable)
    .where(
      and(
        eq(gameParticipantsTable.gameId, gameId),
        eq(gameParticipantsTable.userId, userId),
        isNull(gameParticipantsTable.leftAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Begin a game.
 * - Anonymous: no DB row, self-enforced 1-hour wall-clock cap client-side.
 * - Signed-in: provisions an in-progress row + the host participant row.
 *   Lazily sweeps the user's stale in-progress games first.
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
  const requestedSlots =
    typeof (req.body as { maxPlayers?: unknown })?.maxPlayers === "number"
      ? ((req.body as { maxPlayers: number }).maxPlayers as number)
      : null;
  const maxPlayers = defaultMaxPlayers(parsed.data.gameType, requestedSlots);
  const shareCode = await generateUniqueShareCode();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(gamesTable).values({
      id,
      userId: user.id,
      gameType: parsed.data.gameType,
      maxPlayers,
      shareCode,
      gameState: {
        gameType: parsed.data.gameType,
        startedAt: now.toISOString(),
        shareCode,
      },
      startedAt: now,
      lastActivityAt: now,
      endedAt: null,
      outcome: null,
    });
    await tx.insert(gameParticipantsTable).values({
      gameId: id,
      slotIndex: 0,
      userId: user.id,
      displayName: user.screenName,
      isHost: true,
      joinedAt: now,
      statsStartAt: now,
    });
  });

  res.json(
    StartGameResponse.parse({
      allowed: true,
      tier: entitlement.tier,
      gameId: id,
      shareCode,
      maxPlayers,
      inactivityTimeoutMs: INACTIVITY_FORFEIT_MS,
      maxGameDurationMs: null,
    }),
  );
});

/**
 * Record a logged in-game action — bumps lastActivityAt for an in-progress
 * game. Allowed for any current participant (host-resilient resume), not
 * just the original creator.
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
  // Sweep the host's stale rows so this row gets closed if it's past
  // the cap. Cheap because /games/activity is already per-shot.
  const ownerRow = await db
    .select({ userId: gamesTable.userId })
    .from(gamesTable)
    .where(eq(gamesTable.id, parsed.data.gameId))
    .limit(1);
  if (ownerRow[0]) await sweepStaleGames(ownerRow[0].userId);

  if (!(await isParticipantOf(parsed.data.gameId, user.id))) {
    res.json(
      RecordGameActivityResponse.parse({
        alive: false,
        message: "Not a participant of this game",
      }),
    );
    return;
  }

  const setFields: { lastActivityAt: Date; gameState?: Record<string, unknown> } = {
    lastActivityAt: new Date(),
  };
  if (parsed.data.gameState !== undefined && parsed.data.gameState !== null) {
    setFields.gameState = parsed.data.gameState as Record<string, unknown>;
  }
  const updated = await db
    .update(gamesTable)
    .set(setFields)
    .where(and(eq(gamesTable.id, parsed.data.gameId), isNull(gamesTable.endedAt)))
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
 * - Anonymous: no-op.
 * - Signed-in: finalize the in-progress row created at /games/start.
 *   Allowed for any participant (so a non-host who became the scorekeeper
 *   after a host-leave can still wrap up the game).
 */
router.post("/games/save", async (req, res): Promise<void> => {
  const parsed = SaveGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const verified = await getVerifiedSubject(req);

  if (!verified) {
    res.json(SaveGameResponse.parse({ saved: false, message: "Anonymous — game not saved" }));
    return;
  }

  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(500).json({ error: "Failed to provision user" });
    return;
  }

  const bpmInt = parsed.data.bpm == null ? null : Math.round(Number(parsed.data.bpm) * 10);

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

  await sweepStaleGames(user.id);

  let id = parsed.data.gameId ?? null;
  if (id) {
    if (!(await isParticipantOf(id, user.id))) {
      // Not a current participant — try owner-only fallback for legacy rows.
      const ownerRow = await db
        .select({ userId: gamesTable.userId })
        .from(gamesTable)
        .where(eq(gamesTable.id, id))
        .limit(1);
      if (!ownerRow[0] || ownerRow[0].userId !== user.id) {
        res.json(SaveGameResponse.parse({ saved: false, message: "Not a participant" }));
        return;
      }
    }

    const updated = await db
      .update(gamesTable)
      .set(fields)
      .where(and(eq(gamesTable.id, id), isNull(gamesTable.endedAt)))
      .returning({ id: gamesTable.id });
    if (updated.length === 0) {
      const existing = await db
        .select()
        .from(gamesTable)
        .where(eq(gamesTable.id, id))
        .limit(1);
      const row = existing[0];
      if (!row) {
        id = null;
      } else {
        const gs = row.gameState as { forfeitReason?: unknown } | null;
        const reason =
          typeof gs?.forfeitReason === "string" ? (gs.forfeitReason as string) : undefined;
        const endReason =
          reason === "max_duration_60min" || reason === "inactivity_60min" ? reason : undefined;
        req.log.info(
          { userId: user.id, gameId: id, endReason },
          "Game save refused — row already ended",
        );
        res.json(
          SaveGameResponse.parse({
            saved: true,
            gameId: id,
            alreadyEnded: true,
            ...(endReason ? { endReason } : {}),
            message: "Game already finalized by server",
          }),
        );
        return;
      }
    }
  }
  if (!id) {
    id = newId();
    await db.insert(gamesTable).values({ id, userId: user.id, ...fields });
    // Self-participate so history queries pick it up.
    await db
      .insert(gameParticipantsTable)
      .values({
        gameId: id,
        slotIndex: 0,
        userId: user.id,
        displayName: user.screenName,
        isHost: true,
        joinedAt: fields.startedAt,
        statsStartAt: fields.startedAt,
      })
      .onConflictDoNothing();
  }

  req.log.info({ userId: user.id, gameId: id, outcome: parsed.data.outcome }, "Game saved");
  res.json(SaveGameResponse.parse({ saved: true, gameId: id, message: "Game saved" }));
});

/**
 * Most-recent in-progress game where the caller is a current participant
 * (host OR joiner — host-resilient resume). Sweeps the user's hosted
 * stale rows first.
 */
router.get("/games/resume", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.json(GetResumableGameResponse.parse({ resumable: false }));
    return;
  }
  await sweepStaleGames(user.id);
  const rows = await db
    .select({ game: gamesTable })
    .from(gameParticipantsTable)
    .innerJoin(gamesTable, eq(gameParticipantsTable.gameId, gamesTable.id))
    .where(
      and(
        eq(gameParticipantsTable.userId, user.id),
        isNull(gameParticipantsTable.leftAt),
        isNull(gamesTable.endedAt),
      ),
    )
    .orderBy(desc(gamesTable.lastActivityAt))
    .limit(1);
  if (rows.length === 0) {
    res.json(GetResumableGameResponse.parse({ resumable: false }));
    return;
  }
  const row = rows[0].game;
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
 * prompt). Marks the row as a forfeit. Only the host may abandon.
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

// ──────────────────────────────────────────────────────────────────────────
// Share codes & joining
// ──────────────────────────────────────────────────────────────────────────

/**
 * In-memory token-bucket per IP for the /games/resolve endpoint. Protects
 * against brute-forcing share codes. Resets on process restart — fine for
 * the threat model (32^5 keyspace + 60/min cap → guessing is infeasible).
 */
const RESOLVE_RATE_WINDOW_MS = 60 * 1000;
const RESOLVE_RATE_MAX = 60;
const resolveBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const b = resolveBuckets.get(ip);
  if (!b || b.resetAt <= now) {
    resolveBuckets.set(ip, { count: 1, resetAt: now + RESOLVE_RATE_WINDOW_MS });
    return true;
  }
  if (b.count >= RESOLVE_RATE_MAX) return false;
  b.count += 1;
  return true;
}

/**
 * Look up a share code → game metadata. Rate-limited per-IP. Never
 * returns the full gameState — caller must POST /games/join.
 */
router.post("/games/resolve", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (!rateLimit(ip)) {
    res.status(429).json(
      ResolveShareCodeResponse.parse({
        found: false,
        reason: "rate_limited",
      }),
    );
    return;
  }
  const parsed = ResolveShareCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const code = normalizeShareCode(parsed.data.code);
  if (!code) {
    res.json(ResolveShareCodeResponse.parse({ found: false, reason: "not_found" }));
    return;
  }
  // Look up the most recent row with this code; only an in-progress one
  // is joinable. Sweep the host's stale rows first so a row past its cap
  // surfaces as "ended", not joinable.
  const rows = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.shareCode, code))
    .orderBy(desc(gamesTable.startedAt))
    .limit(1);
  if (rows.length === 0) {
    res.json(ResolveShareCodeResponse.parse({ found: false, reason: "not_found" }));
    return;
  }
  const row = rows[0];
  await sweepStaleGames(row.userId);
  // Re-fetch in case the sweep just closed it.
  const fresh = (
    await db.select().from(gamesTable).where(eq(gamesTable.id, row.id)).limit(1)
  )[0];
  if (!fresh || fresh.endedAt) {
    res.json(ResolveShareCodeResponse.parse({ found: false, reason: "ended" }));
    return;
  }
  const filled = await db
    .select({ c: count() })
    .from(gameParticipantsTable)
    .where(
      and(eq(gameParticipantsTable.gameId, fresh.id), isNull(gameParticipantsTable.leftAt)),
    );
  const hostRow = await db
    .select({ name: gameParticipantsTable.displayName })
    .from(gameParticipantsTable)
    .where(and(eq(gameParticipantsTable.gameId, fresh.id), eq(gameParticipantsTable.isHost, true)))
    .limit(1);
  res.json(
    ResolveShareCodeResponse.parse({
      found: true,
      gameId: fresh.id,
      gameType: fresh.gameType as "8ball" | "9ball" | "practice",
      maxPlayers: fresh.maxPlayers,
      filledSlots: filled[0]?.c ?? 0,
      soloMode: isSoloMode(fresh.gameType, fresh.maxPlayers),
      hostName: hostRow[0]?.name ?? "Host",
    }),
  );
});

/**
 * Join an active game by share code. Atomically allocates the next open
 * slot (first-come-first-served), or returns spectator status when slots
 * are full / the mode is solo. Anonymous callers get a guest displayName
 * and are NOT participants (no DB row written) — they observe only.
 */
router.post("/games/join", async (req, res): Promise<void> => {
  const parsed = JoinGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const code = normalizeShareCode(parsed.data.code);
  if (!code) {
    res.json(
      JoinGameResponse.parse({
        joined: false,
        role: "spectator",
        gameId: "",
        gameType: "8ball",
        slotIndex: null,
        displayName: "",
        shareCode: "",
        reason: "not_found",
      }),
    );
    return;
  }
  const rows = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.shareCode, code))
    .orderBy(desc(gamesTable.startedAt))
    .limit(1);
  const row = rows[0];
  if (!row) {
    res.json(
      JoinGameResponse.parse({
        joined: false,
        role: "spectator",
        gameId: "",
        gameType: "8ball",
        slotIndex: null,
        displayName: "",
        shareCode: code,
        reason: "not_found",
      }),
    );
    return;
  }
  await sweepStaleGames(row.userId);
  const fresh = (
    await db.select().from(gamesTable).where(eq(gamesTable.id, row.id)).limit(1)
  )[0];
  if (!fresh || fresh.endedAt) {
    res.json(
      JoinGameResponse.parse({
        joined: false,
        role: "spectator",
        gameId: fresh?.id ?? "",
        gameType: (fresh?.gameType as "8ball" | "9ball" | "practice") ?? "8ball",
        slotIndex: null,
        displayName: "",
        shareCode: code,
        reason: "ended",
      }),
    );
    return;
  }
  const user = await getOrCreateUser(req);
  const solo = isSoloMode(fresh.gameType, fresh.maxPlayers);

  // Anonymous guest → spectator (no participant row, no stats).
  if (!user) {
    res.json(
      JoinGameResponse.parse({
        joined: true,
        role: "spectator",
        gameId: fresh.id,
        gameType: fresh.gameType as "8ball" | "9ball" | "practice",
        slotIndex: null,
        displayName: parsed.data.guestName?.trim() || "Guest",
        shareCode: code,
      }),
    );
    return;
  }

  // Already a participant? Idempotent — return their existing slot.
  const existing = await db
    .select()
    .from(gameParticipantsTable)
    .where(
      and(
        eq(gameParticipantsTable.gameId, fresh.id),
        eq(gameParticipantsTable.userId, user.id),
        isNull(gameParticipantsTable.leftAt),
      ),
    )
    .limit(1);
  if (existing[0]) {
    res.json(
      JoinGameResponse.parse({
        joined: true,
        role: "already_joined",
        // 'host' tells the joiner UI to redirect the host away from the
        // read-only view (avoids an accidental self-forfeit).
        reason: existing[0].isHost ? "host" : undefined,
        gameId: fresh.id,
        gameType: fresh.gameType as "8ball" | "9ball" | "practice",
        slotIndex: existing[0].slotIndex,
        displayName: existing[0].displayName,
        shareCode: code,
      }),
    );
    return;
  }

  // Solo modes: signed-in non-host → spectator (no slot allocation).
  if (solo) {
    res.json(
      JoinGameResponse.parse({
        joined: true,
        role: "spectator",
        gameId: fresh.id,
        gameType: fresh.gameType as "8ball" | "9ball" | "practice",
        slotIndex: null,
        displayName: user.screenName,
        shareCode: code,
      }),
    );
    return;
  }

  // Try to allocate the next open slot atomically.
  const now = new Date();
  let assignedSlot: number | null = null;
  await db.transaction(async (tx) => {
    const taken = await tx
      .select({ slot: gameParticipantsTable.slotIndex })
      .from(gameParticipantsTable)
      .where(and(eq(gameParticipantsTable.gameId, fresh.id), isNull(gameParticipantsTable.leftAt)));
    const takenSet = new Set(taken.map((t) => t.slot));
    if (takenSet.size >= fresh.maxPlayers) return;
    let next = -1;
    for (let i = 0; i < fresh.maxPlayers; i++) {
      if (!takenSet.has(i)) {
        next = i;
        break;
      }
    }
    if (next < 0) return;
    try {
      await tx.insert(gameParticipantsTable).values({
        gameId: fresh.id,
        slotIndex: next,
        userId: user.id,
        displayName: user.screenName,
        isHost: false,
        joinedAt: now,
        // Join-time cutoff: this user's BPM/stats only count from now on.
        statsStartAt: now,
      });
      assignedSlot = next;
    } catch {
      // PK / unique violation → another joiner won the race; fall through
      // to spectator below.
    }
  });

  if (assignedSlot === null) {
    res.json(
      JoinGameResponse.parse({
        joined: true,
        role: "spectator",
        gameId: fresh.id,
        gameType: fresh.gameType as "8ball" | "9ball" | "practice",
        slotIndex: null,
        displayName: user.screenName,
        shareCode: code,
        reason: "full",
      }),
    );
    return;
  }
  res.json(
    JoinGameResponse.parse({
      joined: true,
      role: "player",
      gameId: fresh.id,
      gameType: fresh.gameType as "8ball" | "9ball" | "practice",
      slotIndex: assignedSlot,
      displayName: user.screenName,
      shareCode: code,
    }),
  );
});

/**
 * Polling endpoint for joiners/spectators. Returns the most recent
 * snapshot of an active game by code. Open (no auth) — share code is
 * the capability.
 */
router.get("/games/state", async (req, res): Promise<void> => {
  const parsed = GetGameStateByCodeQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const code = normalizeShareCode(parsed.data.code);
  if (!code) {
    res.json(GetGameStateByCodeResponse.parse({ found: false }));
    return;
  }
  const rows = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.shareCode, code))
    .orderBy(desc(gamesTable.startedAt))
    .limit(1);
  const row = rows[0];
  if (!row) {
    res.json(GetGameStateByCodeResponse.parse({ found: false }));
    return;
  }
  await sweepStaleGames(row.userId);
  const fresh = (
    await db.select().from(gamesTable).where(eq(gamesTable.id, row.id)).limit(1)
  )[0];
  if (!fresh) {
    res.json(GetGameStateByCodeResponse.parse({ found: false }));
    return;
  }
  const parts = await db
    .select()
    .from(gameParticipantsTable)
    .where(eq(gameParticipantsTable.gameId, fresh.id))
    .orderBy(gameParticipantsTable.slotIndex);
  res.json(
    GetGameStateByCodeResponse.parse({
      found: true,
      gameId: fresh.id,
      gameType: fresh.gameType as "8ball" | "9ball" | "practice",
      ended: !!fresh.endedAt,
      startedAt: fresh.startedAt.toISOString(),
      lastActivityAt: fresh.lastActivityAt.toISOString(),
      gameState: (fresh.gameState as unknown) ?? {},
      participants: parts.map((p) => ({
        slotIndex: p.slotIndex,
        displayName: p.displayName,
        isHost: p.isHost,
        hasLeft: !!p.leftAt,
        isGuest: p.userId == null,
      })),
    }),
  );
});

/**
 * Leave an in-progress game. Marks the caller's participant row as
 * left, then ends the whole game as a forfeit (per SOW: leave =
 * forfeit). The winner derivation mirrors the inactivity sweep.
 */
router.post("/games/leave", async (req, res): Promise<void> => {
  const parsed = LeaveGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  const now = new Date();
  const updated = await db
    .update(gameParticipantsTable)
    .set({ leftAt: now })
    .where(
      and(
        eq(gameParticipantsTable.gameId, parsed.data.gameId),
        eq(gameParticipantsTable.userId, user.id),
        isNull(gameParticipantsTable.leftAt),
      ),
    )
    .returning({ slotIndex: gameParticipantsTable.slotIndex, displayName: gameParticipantsTable.displayName });
  if (updated.length === 0) {
    res.json(LeaveGameResponse.parse({ left: false, gameEnded: false }));
    return;
  }
  // Close the game as a forfeit, attributing the win to a remaining
  // participant when possible.
  const remaining = await db
    .select({ name: gameParticipantsTable.displayName })
    .from(gameParticipantsTable)
    .where(
      and(eq(gameParticipantsTable.gameId, parsed.data.gameId), isNull(gameParticipantsTable.leftAt)),
    )
    .limit(1);
  const winner = remaining[0]?.name ?? null;
  const closed = await db
    .update(gamesTable)
    .set({
      endedAt: now,
      outcome: "forfeit",
      winner,
      gameState: sql`jsonb_set(${gamesTable.gameState}, '{forfeitReason}', '"left"')`,
    })
    .where(and(eq(gamesTable.id, parsed.data.gameId), isNull(gamesTable.endedAt)))
    .returning({ id: gamesTable.id });
  res.json(LeaveGameResponse.parse({ left: true, gameEnded: closed.length > 0 }));
});

const HISTORY_PAGE_SIZE_PASS = 10;

/**
 * Game history. Tier gates the view, not the storage. Lists every game
 * where the caller was a current participant (host OR joiner) — so
 * joiners see games they joined in their own history too.
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

  // Game ids this user is a participant of (any slot, including ones
  // they later left — leaving still counts as participation).
  const participantGameIds = await db
    .select({ gameId: gameParticipantsTable.gameId })
    .from(gameParticipantsTable)
    .where(eq(gameParticipantsTable.userId, user.id));
  const ids = participantGameIds.map((r) => r.gameId);
  if (ids.length === 0) {
    res.json(
      GetGameHistoryResponse.parse({
        tier: entitlement.tier,
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

  const [{ total }] = await db
    .select({ total: count() })
    .from(gamesTable)
    .where(and(inArray(gamesTable.id, ids), isNotNull(gamesTable.endedAt)));
  const totalCount = total;

  let page: number;
  let totalPages: number;
  let rowLimit: number;
  let offset: number;

  if (limit === null) {
    const rawPage = parseInt(String(req.query.page ?? "1"), 10);
    totalPages = Math.max(1, Math.ceil(totalCount / HISTORY_PAGE_SIZE_PASS));
    page = Math.min(Math.max(1, isNaN(rawPage) ? 1 : rawPage), totalPages);
    rowLimit = HISTORY_PAGE_SIZE_PASS;
    offset = (page - 1) * HISTORY_PAGE_SIZE_PASS;
  } else {
    rowLimit = limit;
    offset = 0;
    page = 1;
    totalPages = 1;
  }

  const visible = await db
    .select()
    .from(gamesTable)
    .where(and(inArray(gamesTable.id, ids), isNotNull(gamesTable.endedAt)))
    .orderBy(desc(gamesTable.endedAt))
    .limit(rowLimit)
    .offset(offset);

  const games = visible.map((g) => {
    const gs = g.gameState as Record<string, unknown> | null;
    const rawReason =
      gs && typeof gs["forfeitReason"] === "string" ? (gs["forfeitReason"] as string) : undefined;
    const endReason =
      rawReason === "max_duration_60min" || rawReason === "inactivity_60min" ? rawReason : undefined;
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
      ...(endReason ? { endReason } : {}),
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
