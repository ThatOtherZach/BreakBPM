import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, gamesTable, gameParticipantsTable, usersTable } from "@workspace/db";
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
  ResolveWatchByNameQueryParams,
  ResolveWatchByNameResponse,
  GetPublicProfileQueryParams,
  GetPublicProfileResponse,
  GetStatsQueryParams,
  GetStatsResponse,
  DeleteMyGameDataResponse,
} from "@workspace/api-zod";
import { getOrCreateUser, getVerifiedSubject } from "../lib/auth";
import { computeEntitlement, getActivePasses, getActiveSubscription } from "../lib/entitlement";
import { resolveStats, clearUserStatsCache, windowCutoff, FREE_TIER_WINDOW, type StatScope, type StatWindow } from "../lib/stats";
import { sweepStaleGames, INACTIVITY_FORFEIT_MS, MAX_GAME_DURATION_MS } from "../lib/forfeit";
import { newId } from "../lib/ids";
import { generateUniqueShareCode, normalizeShareCode } from "../lib/shareCode";

const router: IRouter = Router();

/** Hard wall-clock cap for anonymous play (no DB row, self-enforced client-side). */
const ANONYMOUS_MAX_GAME_DURATION_MS = MAX_GAME_DURATION_MS;

/** Number of recent games shown on the public /watch/{name} profile. */
const PROFILE_GAME_LIMIT = 5;

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

type GameRow = typeof gamesTable.$inferSelect;

/**
 * Resolve a game's WIN/LOSS/etc. badge and "vs." opponent RELATIVE to a
 * subject player (the account owner or profiled player), rather than in
 * absolute "someone won" terms. The stored `g.outcome` only records whether a
 * human won (`won`) or the Shark won (`lost`); it is NOT viewer-aware, so a
 * game the subject *lost* to another human is stored as `won`. Here we flip it
 * to the subject's perspective using the persisted `players` (with team info).
 *
 * The subject is located by their participant `slotIndex` — `gameState.players`
 * is ordered by slot (players[i] === slot i), so this is rename-proof and
 * unambiguous even when 4P games reuse the same display name. We fall back to
 * matching the current `name` only when the slot is unknown (e.g. legacy rows
 * with no participant record).
 *
 *  - `forfeit` / `completed` / `expired` are preserved (no clear head-to-head).
 *  - With a winner: `won` if the subject (or their team) is the winner, else
 *    `lost`.
 *  - `opponent`: who to show after "vs." — the winner when the subject lost,
 *    or a defeated opposing player when the subject won. Null for Shark games
 *    (the card renders a Shark label) and solo/practice (no opponent).
 *  - When the subject can't be located among the players, we fall back to the
 *    stored outcome and just surface the winner.
 */
function resolveSubjectResult(
  g: GameRow,
  gs: Record<string, unknown> | null,
  subject: { slot: number | null; name: string | null },
): { outcome: string; opponent: string | null } {
  const storedOutcome = g.outcome ?? "completed";
  const winner = g.winner;
  const sharkMode = !!(gs && gs["sharkAggression"]);

  const rawPlayers = Array.isArray(gs?.["players"])
    ? (gs!["players"] as Array<Record<string, unknown>>)
    : [];
  const players = rawPlayers.map((p) => ({
    name: typeof p["name"] === "string" ? (p["name"] as string) : "",
    team: typeof p["team"] === "string" ? (p["team"] as string) : undefined,
  }));
  const teamOf = (name: string): string | undefined =>
    players.find((p) => p.name === name)?.team;

  // No head-to-head winner (practice / expired / abandoned-with-no-winner):
  // preserve the stored outcome, no opponent.
  if (!winner) return { outcome: storedOutcome, opponent: null };

  // Locate the subject by slot (rename-proof), else by current name.
  const subjectIdx =
    subject.slot != null && subject.slot >= 0 && subject.slot < players.length
      ? subject.slot
      : subject.name
        ? players.findIndex((p) => p.name === subject.name)
        : -1;

  // Can't tell the subject's side (legacy row with no players) → keep stored
  // outcome, show the winner as the opponent so the card still reads naturally.
  if (subjectIdx < 0) {
    return { outcome: storedOutcome, opponent: sharkMode ? null : winner };
  }

  const subjectPlayer = players[subjectIdx];
  const subjectTeam = subjectPlayer.team;
  const winnerTeam = teamOf(winner);
  const subjectWon =
    subjectTeam && winnerTeam ? subjectTeam === winnerTeam : winner === subjectPlayer.name;

  // Forfeits stay a DNF badge regardless of the derived winner.
  const outcome = storedOutcome === "forfeit" ? "forfeit" : subjectWon ? "won" : "lost";

  let opponent: string | null = null;
  if (!sharkMode) {
    if (subjectWon) {
      // Prefer a player on the opposing team; otherwise any other slot.
      opponent =
        players.find((p, i) => {
          if (i === subjectIdx || !p.name) return false;
          if (subjectTeam && p.team) return p.team !== subjectTeam;
          return true;
        })?.name ?? null;
    } else {
      opponent = winner;
    }
  }
  return { outcome, opponent };
}

/** Minimal shot-log entry shape parsed out of the gameState JSONB for pace. */
interface PaceShot {
  playerName?: string;
  ball?: number;
  timestamp?: number;
}

/**
 * Per-participant pace for a finished game. With share-code joining a single
 * game row stores the HOST's `bpm` / `sunkBallsCount`, but BPM is per-player —
 * a joiner's pace and ball count are their own, not the host's. We recompute
 * them from the shot log filtered to the participant's SLOT player name
 * (`gameState.players[slot].name` — the same key the host uses to attribute
 * per-slot accuracy at save time) and bounded by the participant's
 * `statsStartAt` cutoff so a joiner only accrues shots from when they joined.
 *
 * Mirrors `calculatePlayerBPM` in gameLogic.ts: anchored at the participant's
 * first pocket, measured to their latest own entry; null with no pockets, 0 for
 * sub-millisecond. Falls back to the row-level host values when the
 * participant's own shots can't be attributed (legacy rows with no participant
 * record, or a name mismatch) AND the subject is the host; a joiner with no
 * attributable shots correctly shows none.
 */
function resolveParticipantPace(
  g: GameRow,
  subject: { slot: number | null; statsStartAt: Date | null; isHost: boolean; known: boolean },
): { bpm: number | null; sunkBallsCount: number } {
  const fallback = {
    bpm: g.bpm == null ? null : g.bpm / 10,
    sunkBallsCount: g.sunkBallsCount,
  };
  // No participant row at all (legacy) → row-level host values.
  if (!subject.known) return fallback;

  const gs = g.gameState as Record<string, unknown> | null;
  const players = Array.isArray(gs?.["players"])
    ? (gs!["players"] as Array<Record<string, unknown>>)
    : [];
  const slot = subject.slot;
  const playerName =
    slot != null && slot >= 0 && slot < players.length && typeof players[slot]?.["name"] === "string"
      ? (players[slot]["name"] as string)
      : null;
  if (!playerName) return subject.isHost ? fallback : { bpm: null, sunkBallsCount: 0 };

  const shotLog = Array.isArray(gs?.["shotLog"]) ? (gs!["shotLog"] as PaceShot[]) : [];
  const startMs = subject.statsStartAt ? subject.statsStartAt.getTime() : -Infinity;
  const mine = shotLog.filter(
    (e) =>
      e.playerName === playerName &&
      typeof e.timestamp === "number" &&
      (e.timestamp as number) >= startMs,
  );
  // Couldn't attribute any of this participant's own entries: host keeps the
  // row-level values (legacy / name-mismatch safety); a joiner has genuinely
  // none of their own.
  if (mine.length === 0) return subject.isHost ? fallback : { bpm: null, sunkBallsCount: 0 };

  // A "pocketed" entry is any one where a ball was sunk (sink, or a terminal
  // win/lose that pocketed) — keyed off `ball` being a number, mirroring
  // calculatePlayerBPM. Misses/fouls/safeties and Shark steals don't count.
  const sinks = mine.filter((e) => typeof e.ball === "number");
  const sunkBallsCount = sinks.length;
  if (sinks.length === 0) return { bpm: null, sunkBallsCount };
  const firstSinkAt = sinks[0].timestamp as number;
  const lastAt = (mine[mine.length - 1].timestamp as number) ?? firstSinkAt;
  const elapsed = (lastAt - firstSinkAt) / 60000;
  const bpm = elapsed < 0.001 ? 0 : Math.round((sinks.length / elapsed) * 10) / 10;
  return { bpm, sunkBallsCount };
}

/**
 * Map a stored game row into a GameHistoryEntry — the shape rendered by the
 * shared history cards on both the owner's account page and the public
 * /watch/{name} profile. `accuracy` is resolved by the caller (per-participant
 * where known, row-level fallback). `pace` carries the subject's own BPM and
 * sunk-ball count (see `resolveParticipantPace`). `subject` identifies the
 * player whose history this is (by stable slot, with name fallback), used to
 * make the outcome/opponent viewer-relative.
 */
function toHistoryEntry(
  g: GameRow,
  accuracy: number | null,
  subject: { slot: number | null; name: string | null },
  pace: { bpm: number | null; sunkBallsCount: number },
) {
  const gs = g.gameState as Record<string, unknown> | null;
  const rawReason =
    gs && typeof gs["forfeitReason"] === "string" ? (gs["forfeitReason"] as string) : undefined;
  const endReason =
    rawReason === "max_duration_60min" || rawReason === "inactivity_60min" ? rawReason : undefined;
  const shotLog = Array.isArray(gs?.["shotLog"])
    ? (gs!["shotLog"] as Array<Record<string, unknown>>)
    : [];
  // Pocketing events only — any shot-log entry that actually sank a ball
  // (sinks plus a terminal win/lose that pocketed). Order is preserved.
  const pocketSequence = shotLog
    .filter((e) => typeof e["ball"] === "number")
    .map((e) => ({
      ball: e["ball"] as number,
      player: typeof e["playerName"] === "string" ? (e["playerName"] as string) : "",
    }));
  const { outcome, opponent } = resolveSubjectResult(g, gs, subject);
  return {
    id: g.id,
    gameType: g.gameType,
    winner: g.winner,
    opponent,
    bpm: pace.bpm,
    accuracy,
    durationMs: g.durationMs,
    sunkBallsCount: pace.sunkBallsCount,
    outcome,
    shareCode: g.shareCode,
    endedAt: g.endedAt!,
    startedAt: g.startedAt,
    sharkMode: !!(gs && gs["sharkAggression"]),
    pocketSequence,
    ...(endReason ? { endReason } : {}),
  };
}

/**
 * Spectating (read-only watching) is a paid host feature: a game is only
 * watchable when its HOST has an active paid entitlement — either a
 * one-time pass OR an active subscription. Players claiming open seats
 * pre-break are always free; this gate only applies to the spectator
 * (view-only) role. Watchers themselves never pay.
 */
async function hostSpectatingEnabled(hostUserId: string): Promise<boolean> {
  const [passes, subscription] = await Promise.all([
    getActivePasses(hostUserId),
    getActiveSubscription(hostUserId),
  ]);
  return passes.length > 0 || subscription !== null;
}

/**
 * Resolve any current participant (host or joiner, not left). Used to
 * authorize activity/save/state writes on a game.
 */
/**
 * Backfill missing host participant rows for this user's legacy games
 * (pre-v0.7 games that were created before game_participants existed).
 * Idempotent — only inserts rows for games whose `userId` matches and
 * which have no participant rows yet. Without this, /games/history and
 * /games/resume — which now key off participant membership — would
 * hide a user's pre-v0.7 game history. Cheap to call on every
 * relevant request (a single LEFT-JOIN scan over the user's games).
 */
async function backfillHostParticipants(userId: string): Promise<void> {
  const legacy = await db
    .select({ gameId: gamesTable.id, startedAt: gamesTable.startedAt })
    .from(gamesTable)
    .leftJoin(gameParticipantsTable, eq(gameParticipantsTable.gameId, gamesTable.id))
    .where(and(eq(gamesTable.userId, userId), isNull(gameParticipantsTable.gameId)));
  if (legacy.length === 0) return;
  const userRow = await db
    .select({ screenName: usersTable.screenName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const screenName = userRow[0]?.screenName ?? "Host";
  for (const r of legacy) {
    try {
      await db.insert(gameParticipantsTable).values({
        gameId: r.gameId,
        slotIndex: 0,
        userId,
        displayName: screenName,
        isHost: true,
        joinedAt: r.startedAt,
        statsStartAt: r.startedAt,
      });
    } catch {
      // Race with a concurrent backfill / participant insert — fine,
      // the row exists now.
    }
  }
}

/**
 * Is this user the active scorekeeping host of the game? Only the host
 * device may write to game state (/games/activity, /games/save) —
 * joiners are view-only via /join/:code. This is the server-side
 * authority check that backs the view-only invariant.
 */
async function isHostOf(gameId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ slotIndex: gameParticipantsTable.slotIndex })
    .from(gameParticipantsTable)
    .where(
      and(
        eq(gameParticipantsTable.gameId, gameId),
        eq(gameParticipantsTable.userId, userId),
        eq(gameParticipantsTable.isHost, true),
        isNull(gameParticipantsTable.leftAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

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

  // Only the scorekeeping host may write game state — joiners are
  // view-only and observe via /games/state polling.
  if (!(await isHostOf(parsed.data.gameId, user.id))) {
    res.json(
      RecordGameActivityResponse.parse({
        alive: false,
        message: "Only the scorekeeper can update this game",
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
    accuracy: parsed.data.accuracy ?? null,
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
    // Only the scorekeeping host may finalize the game — joiners are
    // view-only.
    if (!(await isHostOf(id, user.id))) {
      // Fallback for legacy (pre-v0.7) rows that may not yet have a
      // participant entry: allow the owner.
      const ownerRow = await db
        .select({ userId: gamesTable.userId })
        .from(gamesTable)
        .where(eq(gamesTable.id, id))
        .limit(1);
      if (!ownerRow[0] || ownerRow[0].userId !== user.id) {
        res.json(SaveGameResponse.parse({ saved: false, message: "Only the scorekeeper can save this game" }));
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

  // Persist each participant's OWN final accuracy (by slot index) so a
  // joiner sees their own accuracy in history, not the host/winner's. The
  // host computes these from the shots logged under each slot's player and
  // sends them keyed by slotIndex (slot 0 = host). Best-effort: never let a
  // per-participant write failure block the (already-succeeded) save.
  const partAcc = parsed.data.participantAccuracies ?? [];
  if (id && partAcc.length > 0) {
    for (const pa of partAcc) {
      try {
        await db
          .update(gameParticipantsTable)
          .set({ accuracy: pa.accuracy ?? null })
          .where(
            and(
              eq(gameParticipantsTable.gameId, id),
              eq(gameParticipantsTable.slotIndex, pa.slotIndex),
            ),
          );
      } catch (err) {
        req.log.warn(
          { userId: user.id, gameId: id, slotIndex: pa.slotIndex, err },
          "Failed to persist participant accuracy",
        );
      }
    }
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
  // Ensure legacy (pre-v0.7) host-owned games have host participant
  // rows so they remain visible/resumable after this release.
  await backfillHostParticipants(user.id);
  const rows = await db
    .select({ game: gamesTable })
    .from(gameParticipantsTable)
    .innerJoin(gamesTable, eq(gameParticipantsTable.gameId, gamesTable.id))
    .where(
      and(
        eq(gameParticipantsTable.userId, user.id),
        // Resume is for the scorekeeping host only — joiners stay
        // view-only and rejoin via /join/:code. This preserves the
        // single-scorekeeper invariant across devices.
        eq(gameParticipantsTable.isHost, true),
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
const codeRateBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * In-memory token-bucket per (IP × bucket-tag) for share-code surfaces.
 * `bucket` lets us throttle each code-discovery endpoint independently
 * (/games/resolve, /games/join, /games/state) so brute-force scanning
 * via any of them is bounded. Buckets reset on process restart — fine
 * given the 32^5 keyspace × per-minute cap.
 */
function rateLimit(ip: string, bucket: string = "resolve"): boolean {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const b = codeRateBuckets.get(key);
  if (!b || b.resetAt <= now) {
    codeRateBuckets.set(key, { count: 1, resetAt: now + RESOLVE_RATE_WINDOW_MS });
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
  const ip = req.ip ?? "unknown";
  if (!rateLimit(ip, "join")) {
    res.status(429).json(
      JoinGameResponse.parse({
        joined: false,
        role: "spectator",
        gameId: "",
        gameType: "8ball",
        slotIndex: null,
        displayName: "",
        shareCode: "",
        reason: "rate_limited",
      }),
    );
    return;
  }
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

  // Pre-break join window. Once the first ball has been pocketed
  // (sink/win/lose entry in the host's shot log), the share code stops
  // allocating new slots — late arrivals can still watch via the read-
  // only spectator view, but cannot claim a player slot. Mirrors how
  // bar pool plays out IRL: once the break happens, you wait for the
  // next rack. Idempotent rejoin paths (guestToken match, signed-in
  // existing participant) below are unaffected — they return the
  // slot the caller already holds.
  const gs = fresh.gameState as { shotLog?: Array<{ type?: string }> } | null;
  const hasPockets =
    Array.isArray(gs?.shotLog) &&
    (gs!.shotLog as Array<{ type?: string }>).some(
      (e) => e && (e.type === "sink" || e.type === "win" || e.type === "lose"),
    );

  // Idempotent rejoin: if the caller presents a guestToken that already
  // owns a (non-left) slot in this game, return that slot instead of
  // allocating a new one. This makes tab-refresh / reopened-link flows
  // safe — a single guest never holds two slots simultaneously.
  if (parsed.data.guestToken) {
    const existingGuest = await db
      .select()
      .from(gameParticipantsTable)
      .where(
        and(
          eq(gameParticipantsTable.gameId, fresh.id),
          eq(gameParticipantsTable.guestToken, parsed.data.guestToken),
          isNull(gameParticipantsTable.leftAt),
        ),
      )
      .limit(1);
    if (existingGuest.length > 0) {
      const p = existingGuest[0];
      res.json(
        JoinGameResponse.parse({
          joined: true,
          role: "already_joined",
          gameId: fresh.id,
          gameType: fresh.gameType as "8ball" | "9ball" | "practice",
          slotIndex: p.slotIndex,
          displayName: p.displayName,
          shareCode: code,
          reason: p.isHost ? "host" : "rejoin",
          guestToken: parsed.data.guestToken,
        }),
      );
      return;
    }
  }

  // Spectating is a paid host feature — compute once for every branch
  // below that would assign the view-only "spectator" role. Player-slot
  // joins (open seats, pre-break) and idempotent rejoins above are NOT
  // affected. The host is always a signed-in user (games.userId notNull),
  // so this checks the game owner's entitlement, never the watcher's.
  const spectatingEnabled = await hostSpectatingEnabled(fresh.userId);

  // Reusable rejection when a non-paying host's game can't be watched.
  // Mirrors the spectator response shape but with joined=false so the
  // joiner UI can show a friendly "watching isn't available" message.
  function spectatorsDisabled(displayName = ""): void {
    res.json(
      JoinGameResponse.parse({
        joined: false,
        role: "spectator",
        gameId: fresh.id,
        gameType: fresh.gameType as "8ball" | "9ball" | "practice",
        slotIndex: null,
        displayName,
        shareCode: code,
        reason: "spectators_disabled",
        guestToken: null,
      }),
    );
  }

  // ── Spectator-only callers (the persistent /watch/{name} link) ───
  // These must NEVER occupy a player slot. Short-circuit straight to the
  // read-only "spectator" role without touching slot allocation. Runs
  // after the idempotent guestToken rejoin above so a device that already
  // holds a guest slot keeps it; a signed-in caller who already holds a
  // slot (e.g. the host opening their own watch link) is recognized here
  // and returned as "already_joined" so the client redirects them out of
  // the read-only view instead of mirroring their own game.
  if (parsed.data.spectatorOnly) {
    if (user) {
      const own = await db
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
      if (own[0]) {
        res.json(
          JoinGameResponse.parse({
            joined: true,
            role: "already_joined",
            reason: own[0].isHost ? "host" : undefined,
            gameId: fresh.id,
            gameType: fresh.gameType as "8ball" | "9ball" | "practice",
            slotIndex: own[0].slotIndex,
            displayName: own[0].displayName,
            shareCode: code,
          }),
        );
        return;
      }
    }
    const watcherName = user
      ? user.screenName
      : parsed.data.guestName?.trim() || "Guest";
    if (!spectatingEnabled) {
      spectatorsDisabled(watcherName);
      return;
    }
    res.json(
      JoinGameResponse.parse({
        joined: true,
        role: "spectator",
        gameId: fresh.id,
        gameType: fresh.gameType as "8ball" | "9ball" | "practice",
        slotIndex: null,
        displayName: watcherName,
        shareCode: code,
        guestToken: null,
      }),
    );
    return;
  }

  // ── Guest (anonymous) joiners ────────────────────────────────────
  // Per task spec: guests play and get real slots; only stats
  // persistence differs (no userId → /games/history will skip them).
  // For solo modes guests stay spectators (no opponent slot to fill).
  if (!user) {
    if (solo) {
      if (!spectatingEnabled) {
        spectatorsDisabled(parsed.data.guestName?.trim() || "Guest");
        return;
      }
      res.json(
        JoinGameResponse.parse({
          joined: true,
          role: "spectator",
          gameId: fresh.id,
          gameType: fresh.gameType as "8ball" | "9ball" | "practice",
          slotIndex: null,
          displayName: parsed.data.guestName?.trim() || "Guest",
          shareCode: code,
          guestToken: null,
        }),
      );
      return;
    }
    if (hasPockets) {
      if (!spectatingEnabled) {
        spectatorsDisabled(parsed.data.guestName?.trim() || "Guest");
        return;
      }
      res.json(
        JoinGameResponse.parse({
          joined: true,
          role: "spectator",
          gameId: fresh.id,
          gameType: fresh.gameType as "8ball" | "9ball" | "practice",
          slotIndex: null,
          displayName: parsed.data.guestName?.trim() || "Guest",
          shareCode: code,
          reason: "in_progress",
          guestToken: null,
        }),
      );
      return;
    }
    const nowG = new Date();
    const guestToken = randomUUID();
    let assignedSlotG: number | null = null;
    let assignedNameG = "";
    let racePostBreakG = false;
    await db.transaction(async (tx) => {
      // Re-check pocket state inside the txn to close the race where the
      // host pockets between the outer `hasPockets` read and this insert.
      // `SELECT … FOR UPDATE` locks the games row so any concurrent
      // host shot-log write via /games/activity must serialize behind
      // (or ahead of) us — we can never observe a pre-break snapshot
      // and then have a pocket land while we're inserting.
      const reread = await tx
        .select({ gameState: gamesTable.gameState })
        .from(gamesTable)
        .where(eq(gamesTable.id, fresh.id))
        .limit(1)
        .for("update");
      const reGs = reread[0]?.gameState as { shotLog?: Array<{ type?: string }> } | null;
      const rePockets =
        Array.isArray(reGs?.shotLog) &&
        (reGs!.shotLog as Array<{ type?: string }>).some(
          (e) => e && (e.type === "sink" || e.type === "win" || e.type === "lose"),
        );
      if (rePockets) {
        racePostBreakG = true;
        return;
      }
      // Slot allocation counts ALL participant rows for this game,
      // including ones with `leftAt` set — leaving = forfeit slot
      // (the slot stays reserved for the leaver and cannot be
      // re-allocated to a different joiner).
      const taken = await tx
        .select({ slot: gameParticipantsTable.slotIndex })
        .from(gameParticipantsTable)
        .where(eq(gameParticipantsTable.gameId, fresh.id));
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
      const displayName = parsed.data.guestName?.trim() || `Player ${next + 1}`;
      try {
        await tx.insert(gameParticipantsTable).values({
          gameId: fresh.id,
          slotIndex: next,
          userId: null,
          displayName,
          isHost: false,
          joinedAt: nowG,
          statsStartAt: nowG,
          guestToken,
        });
        assignedSlotG = next;
        assignedNameG = displayName;
      } catch {
        // race lost
      }
    });
    if (assignedSlotG === null) {
      if (!spectatingEnabled) {
        spectatorsDisabled(parsed.data.guestName?.trim() || "Guest");
        return;
      }
      res.json(
        JoinGameResponse.parse({
          joined: true,
          role: "spectator",
          gameId: fresh.id,
          gameType: fresh.gameType as "8ball" | "9ball" | "practice",
          slotIndex: null,
          displayName: parsed.data.guestName?.trim() || "Guest",
          shareCode: code,
          // Race-lost-to-pocket wins over `full` — surface the real
          // reason the seat couldn't be claimed.
          reason: racePostBreakG ? "in_progress" : "full",
          guestToken: null,
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
        slotIndex: assignedSlotG,
        displayName: assignedNameG,
        shareCode: code,
        guestToken,
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
    if (!spectatingEnabled) {
      spectatorsDisabled(user.screenName);
      return;
    }
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

  // Pre-break gate for signed-in newcomers — see `hasPockets` comment above.
  if (hasPockets) {
    if (!spectatingEnabled) {
      spectatorsDisabled(user.screenName);
      return;
    }
    res.json(
      JoinGameResponse.parse({
        joined: true,
        role: "spectator",
        gameId: fresh.id,
        gameType: fresh.gameType as "8ball" | "9ball" | "practice",
        slotIndex: null,
        displayName: user.screenName,
        shareCode: code,
        reason: "in_progress",
      }),
    );
    return;
  }

  // Try to allocate the next open slot atomically.
  const now = new Date();
  let assignedSlot: number | null = null;
  let racePostBreak = false;
  await db.transaction(async (tx) => {
    // Re-check pocket state inside the txn — see the matching comment in
    // the guest allocation branch above. `FOR UPDATE` locks the games
    // row so a concurrent host pocket-write must serialize against us.
    const reread = await tx
      .select({ gameState: gamesTable.gameState })
      .from(gamesTable)
      .where(eq(gamesTable.id, fresh.id))
      .limit(1)
      .for("update");
    const reGs = reread[0]?.gameState as { shotLog?: Array<{ type?: string }> } | null;
    const rePockets =
      Array.isArray(reGs?.shotLog) &&
      (reGs!.shotLog as Array<{ type?: string }>).some(
        (e) => e && (e.type === "sink" || e.type === "win" || e.type === "lose"),
      );
    if (rePockets) {
      racePostBreak = true;
      return;
    }
    // Slot allocation counts ALL rows including `leftAt`-set ones —
    // forfeited slots stay reserved and can't be reassigned.
    const taken = await tx
      .select({ slot: gameParticipantsTable.slotIndex })
      .from(gameParticipantsTable)
      .where(eq(gameParticipantsTable.gameId, fresh.id));
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
    if (!spectatingEnabled) {
      spectatorsDisabled(user.screenName);
      return;
    }
    res.json(
      JoinGameResponse.parse({
        joined: true,
        role: "spectator",
        gameId: fresh.id,
        gameType: fresh.gameType as "8ball" | "9ball" | "practice",
        slotIndex: null,
        displayName: user.screenName,
        shareCode: code,
        reason: racePostBreak ? "in_progress" : "full",
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
  const ip = req.ip ?? "unknown";
  if (!rateLimit(ip, "state")) {
    res.status(429).json(GetGameStateByCodeResponse.parse({ found: false }));
    return;
  }
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
 * Resolve a host's screen name → the share code of their CURRENT live game.
 *
 * Powers the persistent /watch/{name} spectator link: unlike a per-game
 * share code, this handle is stable across the host's games, so a viewer
 * can bookmark it once and always land on whatever game the host has open
 * now. Returns a `reason` when the name is unknown ("not_found") or the
 * host has no in-progress game right now ("not_live"). Never returns the
 * full gameState — the caller polls /games/state with the share code.
 *
 * The host's entitlement gate is NOT enforced here: the downstream
 * /games/join (and the spectator view) already reject watchers when the
 * host lacks an active pass ("spectators_disabled"), so we keep this
 * lookup cheap and let the join flow own that decision.
 */
router.get("/games/watch-resolve", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (!rateLimit(ip, "state")) {
    res.status(429).json(
      ResolveWatchByNameResponse.parse({ found: false, reason: "rate_limited" }),
    );
    return;
  }
  const parsed = ResolveWatchByNameQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const handle = parsed.data.name.trim().toLowerCase();
  if (!handle) {
    res.json(ResolveWatchByNameResponse.parse({ found: false, reason: "not_found" }));
    return;
  }
  // Resolve the host by case-insensitive screen name (the public handle).
  const [host] = await db
    .select({ id: usersTable.id, screenName: usersTable.screenName })
    .from(usersTable)
    .where(sql`lower(${usersTable.screenName}) = ${handle}`)
    .limit(1);
  if (!host) {
    res.json(ResolveWatchByNameResponse.parse({ found: false, reason: "not_found" }));
    return;
  }
  // Auto-forfeit any stale rows first so a long-idle game surfaces as
  // "not_live" rather than resolving to a dead share code.
  await sweepStaleGames(host.id);
  // Most recent still-running game this user hosts.
  const [live] = await db
    .select({ shareCode: gamesTable.shareCode })
    .from(gamesTable)
    .where(and(eq(gamesTable.userId, host.id), isNull(gamesTable.endedAt)))
    .orderBy(desc(gamesTable.startedAt))
    .limit(1);
  if (!live) {
    res.json(ResolveWatchByNameResponse.parse({ found: false, reason: "not_live" }));
    return;
  }
  res.json(
    ResolveWatchByNameResponse.parse({
      found: true,
      shareCode: live.shareCode,
      hostName: host.screenName,
    }),
  );
});

/**
 * Public profile for a player by screen name. Powers the /watch/{name} page
 * when the player has no live game — shows the same read-only history cards
 * the owner sees on their account page (their five most recent completed
 * games) plus a member-since date. Public (no auth): the screen name is the
 * capability, and only already-public game outcomes are exposed (never email
 * or in-progress state). Tier does NOT gate this view — a profile is a
 * fixed 5-game showcase regardless of who is looking.
 */
router.get("/games/profile", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (!rateLimit(ip, "state")) {
    res.status(429).json(
      GetPublicProfileResponse.parse({ found: false, reason: "rate_limited", games: [] }),
    );
    return;
  }
  const parsed = GetPublicProfileQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const handle = parsed.data.name.trim().toLowerCase();
  if (!handle) {
    res.json(GetPublicProfileResponse.parse({ found: false, reason: "not_found", games: [] }));
    return;
  }
  const [host] = await db
    .select({
      id: usersTable.id,
      screenName: usersTable.screenName,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(sql`lower(${usersTable.screenName}) = ${handle}`)
    .limit(1);
  if (!host) {
    res.json(GetPublicProfileResponse.parse({ found: false, reason: "not_found", games: [] }));
    return;
  }
  // Finalize any stale games and backfill legacy host-owned rows so the
  // profile mirrors exactly what the owner sees in their own history.
  await sweepStaleGames(host.id);
  await backfillHostParticipants(host.id);

  const participantGameIds = await db
    .select({ gameId: gameParticipantsTable.gameId })
    .from(gameParticipantsTable)
    .where(eq(gameParticipantsTable.userId, host.id));
  const ids = participantGameIds.map((r) => r.gameId);

  // All-time stats: gamesPlayed + winRate across all completed non-practice games.
  let gamesPlayed: number | null = null;
  let winRate: number | null = null;
  if (ids.length > 0) {
    const allEnded = await db
      .select({
        id: gamesTable.id,
        gameType: gamesTable.gameType,
        winner: gamesTable.winner,
        outcome: gamesTable.outcome,
        gameState: gamesTable.gameState,
      })
      .from(gamesTable)
      .where(and(inArray(gamesTable.id, ids), isNotNull(gamesTable.endedAt)));

    const allSlots = allEnded.length > 0
      ? await db
          .select({ gameId: gameParticipantsTable.gameId, slotIndex: gameParticipantsTable.slotIndex })
          .from(gameParticipantsTable)
          .where(and(
            inArray(gameParticipantsTable.gameId, allEnded.map((g) => g.id)),
            eq(gameParticipantsTable.userId, host.id),
          ))
      : [];
    const slotByGame = new Map(allSlots.map((p) => [p.gameId, p.slotIndex]));

    const nonPractice = allEnded.filter((g) => g.gameType !== "practice");
    gamesPlayed = nonPractice.length;

    const decisive = nonPractice.filter((g) => g.winner);
    if (decisive.length > 0) {
      let wins = 0;
      for (const g of decisive) {
        const slot = slotByGame.get(g.id) ?? null;
        const gs = g.gameState as Record<string, unknown> | null;
        const { outcome } = resolveSubjectResult(
          g as GameRow,
          gs,
          { slot, name: host.screenName },
        );
        if (outcome === "won") wins++;
      }
      winRate = wins / decisive.length;
    }
  }

  let games: ReturnType<typeof toHistoryEntry>[] = [];
  if (ids.length > 0) {
    const visible = await db
      .select()
      .from(gamesTable)
      .where(and(inArray(gamesTable.id, ids), isNotNull(gamesTable.endedAt)))
      .orderBy(desc(gamesTable.endedAt))
      .limit(PROFILE_GAME_LIMIT);
    const visibleIds = visible.map((g) => g.id);
    // This player's OWN accuracy per game (snapshotted on their participant
    // row), falling back to the row-level winner/host accuracy for legacy rows.
    const parts =
      visibleIds.length > 0
        ? await db
            .select({
              gameId: gameParticipantsTable.gameId,
              accuracy: gameParticipantsTable.accuracy,
              slotIndex: gameParticipantsTable.slotIndex,
              statsStartAt: gameParticipantsTable.statsStartAt,
              isHost: gameParticipantsTable.isHost,
            })
            .from(gameParticipantsTable)
            .where(
              and(
                inArray(gameParticipantsTable.gameId, visibleIds),
                eq(gameParticipantsTable.userId, host.id),
              ),
            )
        : [];
    const partByGame = new Map(parts.map((p) => [p.gameId, p]));
    games = visible.map((g) => {
      const part = partByGame.get(g.id);
      const pace = resolveParticipantPace(g, {
        slot: part?.slotIndex ?? null,
        statsStartAt: part?.statsStartAt ?? null,
        isHost: part?.isHost ?? false,
        known: part !== undefined,
      });
      return toHistoryEntry(
        g,
        part ? (part.accuracy ?? null) : (g.accuracy ?? null),
        { slot: part?.slotIndex ?? null, name: host.screenName },
        pace,
      );
    });
  }

  const bpmValues = games.map((g) => g.bpm).filter((b): b is number => b != null);
  const avgBpm = bpmValues.length > 0
    ? bpmValues.reduce((sum, b) => sum + b, 0) / bpmValues.length
    : null;

  // Full last-24h stats, shaped exactly like /stats so the profile header can
  // render the same CRT hero readout. Always personal scope + 24h window; the
  // tier/capability flags are fixed (this is a public, view-only readout).
  const { core: statsCore, cached: statsCached } = await resolveStats(
    "personal",
    "24h",
    host.id,
    false,
  );
  const { computedAt: statsComputedAt, ...statsRest } = statsCore;
  const stats = {
    tier: "public" as const,
    scope: "personal" as const,
    window: "24h" as const,
    appliedScope: "personal" as const,
    appliedWindow: "24h" as const,
    canChooseWindow: false,
    canToggleGlobal: false,
    canRefresh: false,
    cached: statsCached,
    computedAt: new Date(statsComputedAt).toISOString(),
    ...statsRest,
  };

  res.json(
    GetPublicProfileResponse.parse({
      found: true,
      screenName: host.screenName,
      memberSince: host.createdAt ?? null,
      gamesPlayed,
      winRate,
      avgBpm,
      games,
      stats,
    }),
  );
});

/**
 * Leave an in-progress game. Marks **only the caller's** participant
 * row as left — the slot stays occupied (no other joiner can claim it)
 * and the game itself keeps running. The departure is a forfeit for
 * the leaver's stats (their statsStartAt..leftAt window is what counts
 * in /games/history), not for the game.
 *
 * The game ends only when there are no remaining (non-left) human
 * participants — i.e. everyone has bailed.
 *
 * Authentication: signed-in callers are matched by Clerk userId; guest
 * (anonymous) participants pass back the `guestToken` they received
 * from /games/join.
 */
router.post("/games/leave", async (req, res): Promise<void> => {
  const parsed = LeaveGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  const now = new Date();

  // Build the WHERE for the caller's participant row. Signed-in users
  // win over the guest token if both happen to be present.
  let updated: { slotIndex: number; displayName: string }[];
  if (user) {
    updated = await db
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
  } else if (parsed.data.guestToken) {
    updated = await db
      .update(gameParticipantsTable)
      .set({ leftAt: now })
      .where(
        and(
          eq(gameParticipantsTable.gameId, parsed.data.gameId),
          eq(gameParticipantsTable.guestToken, parsed.data.guestToken),
          isNull(gameParticipantsTable.leftAt),
        ),
      )
      .returning({ slotIndex: gameParticipantsTable.slotIndex, displayName: gameParticipantsTable.displayName });
  } else {
    res.status(401).json({ error: "Sign in required, or pass guestToken from /games/join" });
    return;
  }
  if (updated.length === 0) {
    res.json(LeaveGameResponse.parse({ left: false, gameEnded: false }));
    return;
  }

  // Only when zero non-left participants remain do we close the row as
  // an "everyone-bailed" forfeit. Otherwise the game keeps playing —
  // remaining participants can finish naturally on /games/save.
  const remaining = await db
    .select({ slotIndex: gameParticipantsTable.slotIndex })
    .from(gameParticipantsTable)
    .where(
      and(eq(gameParticipantsTable.gameId, parsed.data.gameId), isNull(gameParticipantsTable.leftAt)),
    );
  let gameEnded = false;
  if (remaining.length === 0) {
    const closed = await db
      .update(gamesTable)
      .set({
        endedAt: now,
        outcome: "forfeit",
        gameState: sql`jsonb_set(${gamesTable.gameState}, '{forfeitReason}', '"all_left"')`,
      })
      .where(and(eq(gamesTable.id, parsed.data.gameId), isNull(gamesTable.endedAt)))
      .returning({ id: gamesTable.id });
    gameEnded = closed.length > 0;
  }
  res.json(LeaveGameResponse.parse({ left: true, gameEnded }));
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
  // Backfill legacy host-owned games into game_participants so they
  // remain visible in this user's history after the v0.7 cut-over to
  // participant-based membership.
  await backfillHostParticipants(user.id);

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

  // BPM is per-player: the game row stores the HOST's bpm / sunk-ball
  // count, but a joiner's pace and ball count are their own. Both are
  // recomputed per participant from the shot log (see
  // `resolveParticipantPace`), filtered to the participant's slot player
  // name and bounded by their `statsStartAt` cutoff, with a row-level
  // host fallback for legacy / name-mismatch rows.
  //
  // Accuracy is likewise per-participant: each joiner sees their OWN
  // accuracy (snapshotted on their game_participants row at save time),
  // falling back to the row-level winner/host accuracy for legacy rows
  // that predate per-participant accuracy.
  const visibleIds = visible.map((g) => g.id);
  const myParts =
    visibleIds.length > 0
      ? await db
          .select({
            gameId: gameParticipantsTable.gameId,
            accuracy: gameParticipantsTable.accuracy,
            slotIndex: gameParticipantsTable.slotIndex,
            statsStartAt: gameParticipantsTable.statsStartAt,
            isHost: gameParticipantsTable.isHost,
          })
          .from(gameParticipantsTable)
          .where(
            and(
              inArray(gameParticipantsTable.gameId, visibleIds),
              eq(gameParticipantsTable.userId, user.id),
            ),
          )
      : [];
  const myPartByGame = new Map(myParts.map((p) => [p.gameId, p]));

  const games = visible.map((g) => {
    const part = myPartByGame.get(g.id);
    const pace = resolveParticipantPace(g, {
      slot: part?.slotIndex ?? null,
      statsStartAt: part?.statsStartAt ?? null,
      isHost: part?.isHost ?? false,
      known: part !== undefined,
    });
    return toHistoryEntry(
      g,
      part ? (part.accuracy ?? null) : (g.accuracy ?? null),
      { slot: part?.slotIndex ?? null, name: user.screenName },
      pace,
    );
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

/**
 * Aggregate shooting statistics, gated by tier:
 *  - anonymous     → global scope, 24h window, no toggles/refresh
 *  - signed-in     → personal scope, 24h window, no toggles/refresh
 *  - pass holders  → personal stats with selectable window + global overlay
 *                    + manual refresh (cache bypass)
 *
 * Results are served from a 1-hour in-memory cache keyed by scope/window
 * (and userId for personal); pass holders may force a recompute.
 */
router.get("/stats", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (!rateLimit(ip, "state")) {
    res.status(429).json({ error: "rate_limited" });
    return;
  }

  const parsed = GetStatsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_query" });
    return;
  }
  const { window, scope, refresh } = parsed.data;

  const user = await getOrCreateUser(req);
  const entitlement = await computeEntitlement(user);
  const tier = entitlement.tier;
  const isPass = tier === "pass";

  // Clamp the requested scope/window to what this tier may access.
  let appliedScope: StatScope;
  let appliedWindow: StatWindow;
  if (!user) {
    appliedScope = "global";
    appliedWindow = "24h";
  } else if (!isPass) {
    // Free signed-in: personal stats stay capped at the free window, but the
    // global "Everyone" view is offered as a taste — at the all-time window.
    appliedScope = scope;
    appliedWindow = scope === "global" ? "all" : FREE_TIER_WINDOW;
  } else {
    appliedScope = scope;
    appliedWindow = window;
  }

  const effectiveRefresh = isPass && refresh;
  const { core, cached } = await resolveStats(
    appliedScope,
    appliedWindow,
    user?.id ?? null,
    effectiveRefresh,
  );

  const { computedAt, ...rest } = core;
  res.json(
    GetStatsResponse.parse({
      tier,
      scope,
      window,
      appliedScope,
      appliedWindow,
      canChooseWindow: isPass,
      canToggleGlobal: isPass || tier === "account",
      canRefresh: isPass,
      cached,
      computedAt: new Date(computedAt).toISOString(),
      ...rest,
    }),
  );
});

/**
 * Escape a single value for CSV output (RFC 4180): wrap in double quotes when
 * it contains a comma, quote, or newline, and double any embedded quotes.
 *
 * Also neutralizes spreadsheet formula injection: a cell whose text starts
 * with =, +, -, @, tab, or CR is treated as a formula by Excel/Sheets, so we
 * prefix such values with an apostrophe to force them to render as plain text
 * (player names and notes are user-controlled and end up in this file).
 */
function csvCell(value: unknown): string {
  if (value == null) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Read a typed field off a loosely-typed shot-log entry. */
function shotField<T>(e: Record<string, unknown>, key: string, kind: "number" | "string" | "boolean"): T | "" {
  const v = e[key];
  return typeof v === kind ? (v as T) : "";
}

/**
 * Export every game the caller participated in (hosted or joined) as a single
 * flat CSV — one row per logged shot, with the game-level columns repeated on
 * each row so the file is self-contained and opens directly in a spreadsheet.
 * Games with no shots still emit one row so they appear in the export.
 * Requires authentication.
 */
router.get("/games/export", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "sign_in_required" });
    return;
  }

  // Free (non-pass) accounts can only export their most recent window of games,
  // mirroring what the free stats tier can see; pass holders export everything.
  const entitlement = await computeEntitlement(user);
  const exportCutoff =
    entitlement.tier === "pass" ? null : windowCutoff(FREE_TIER_WINDOW);

  // Every game this user has a participation slot in (host or joiner).
  const parts = await db
    .select({ gameId: gameParticipantsTable.gameId })
    .from(gameParticipantsTable)
    .where(eq(gameParticipantsTable.userId, user.id));
  const ids = parts.map((p) => p.gameId);

  const header = [
    "game_id", "game_type", "share_code", "outcome", "winner",
    "game_bpm", "game_accuracy_pct", "duration_ms", "sunk_balls_count",
    "shark_mode", "started_at", "ended_at",
    "shot_index", "shot_type", "shot_player", "shot_ball", "shot_bpm",
    "shot_is_foul", "shot_game_time_ms", "shot_timestamp", "shot_note",
  ];
  const rows: string[] = [header.join(",")];

  let exportedGames = 0;
  if (ids.length > 0) {
    const conds = [inArray(gamesTable.id, ids)];
    if (exportCutoff) conds.push(gte(gamesTable.startedAt, exportCutoff));
    const games = await db
      .select()
      .from(gamesTable)
      .where(and(...conds))
      .orderBy(desc(gamesTable.startedAt));
    exportedGames = games.length;

    for (const g of games) {
      const gs = (g.gameState ?? {}) as Record<string, unknown>;
      const sharkMode = gs["sharkAggression"] != null;
      const shotLog = Array.isArray(gs["shotLog"])
        ? (gs["shotLog"] as Array<Record<string, unknown>>)
        : [];
      const base: unknown[] = [
        g.id,
        g.gameType,
        g.shareCode,
        g.outcome ?? "",
        g.winner ?? "",
        g.bpm == null ? "" : g.bpm / 10,
        g.accuracy ?? "",
        g.durationMs,
        g.sunkBallsCount,
        sharkMode,
        g.startedAt.toISOString(),
        g.endedAt ? g.endedAt.toISOString() : "",
      ];

      if (shotLog.length === 0) {
        rows.push([...base, "", "", "", "", "", "", "", "", ""].map(csvCell).join(","));
        continue;
      }

      shotLog.forEach((e, i) => {
        const ts = shotField<number>(e, "timestamp", "number");
        rows.push(
          [
            ...base,
            i,
            shotField<string>(e, "type", "string"),
            shotField<string>(e, "playerName", "string"),
            shotField<number>(e, "ball", "number"),
            shotField<number>(e, "bpm", "number"),
            shotField<boolean>(e, "isFoul", "boolean"),
            shotField<number>(e, "gameTime", "number"),
            ts === "" ? "" : new Date(ts).toISOString(),
            shotField<string>(e, "note", "string"),
          ].map(csvCell).join(","),
        );
      });
    }
  }

  const csv = rows.join("\r\n") + "\r\n";
  const filename = `breakbpm-export-${new Date().toISOString().slice(0, 10)}.csv`;
  req.log.info(
    { userId: user.id, candidateGames: ids.length, exportedGames, capped: !!exportCutoff },
    "Exported game data",
  );
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});

/** Placeholder name a departing player's identity collapses to on delete. */
const ANON_PLAYER_BASE_NAME = "🕴️ Mr. X";

/**
 * Pick a placeholder name that doesn't already exist in a game. Returns the
 * base "🕴️ Mr. X" when free, otherwise appends " 2", " 3", … so two
 * anonymized players in the same game never collide and merge stats.
 */
function uniqueAnonName(taken: Set<string>): string {
  if (!taken.has(ANON_PLAYER_BASE_NAME)) return ANON_PLAYER_BASE_NAME;
  for (let n = 2; ; n++) {
    const candidate = `${ANON_PLAYER_BASE_NAME} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Permanently scrub the caller from all of their game data. Runs in one
 * transaction over every game the user took part in (hosted or joined),
 * in-progress or completed:
 *
 *   - If no OTHER real (signed-in) player remains, the whole game is deleted.
 *     Its shot log lives in gameState, so the row delete removes the shots and
 *     the FK cascade clears participant slots. Covers solo games, games nobody
 *     joined, and the "both players delete" case (whoever deletes second finds
 *     no real player left and the game is removed).
 *   - Otherwise the caller alone is removed: their name is replaced with a
 *     collision-safe "🕴️ Mr. X" placeholder throughout the stored game (the
 *     player list, every shot-log entry, and the winner — both gameState and
 *     the denormalized games.winner column), and their participant slot is
 *     detached (userId nulled). The game stays correct for the remaining
 *     players; it leaves the caller's history/stats/export because those key
 *     off the participation link.
 *
 * Renaming is consistent and never removes shot entries — the game engine
 * derives pace, accuracy, and rack state from the full ordered shot log, so
 * dropping entries would corrupt the remaining players' game.
 *
 * The user record, passes, and subscriptions are untouched. Requires auth.
 */
router.delete("/games/data", async (req, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "sign_in_required" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    // Every game the caller touches: games they host + games they hold a
    // participant slot in. Sorted so concurrent deletes acquire per-game row
    // locks in a consistent order (no deadlocks).
    const hosted = await tx
      .select({ id: gamesTable.id })
      .from(gamesTable)
      .where(eq(gamesTable.userId, user.id));
    const joined = await tx
      .select({ gameId: gameParticipantsTable.gameId })
      .from(gameParticipantsTable)
      .where(eq(gameParticipantsTable.userId, user.id));
    const gameIds = [
      ...new Set<string>([...hosted.map((g) => g.id), ...joined.map((p) => p.gameId)]),
    ].sort();

    let deletedGames = 0;
    let anonymizedGames = 0;

    for (const gameId of gameIds) {
      // Lock this game's participant rows for the rest of the transaction so
      // two real players deleting the same game serialize: the second one
      // then sees the first's slot already detached and full-deletes (which
      // is the intended "second deleter removes the game" outcome).
      const participants = await tx
        .select()
        .from(gameParticipantsTable)
        .where(eq(gameParticipantsTable.gameId, gameId))
        .for("update");

      // Other REAL players = signed-in slots that aren't the caller. Guests
      // (userId null) and already-anonymized slots do not count.
      const realOthers = participants.filter(
        (p) => p.userId != null && p.userId !== user.id,
      );

      if (realOthers.length === 0) {
        // No one else would lose this game → delete it outright (cascade
        // clears participant rows; the shot log goes with the row).
        await tx.delete(gamesTable).where(eq(gamesTable.id, gameId));
        deletedGames += 1;
        continue;
      }

      // Someone else keeps this game → anonymize just the caller. This
      // requires the caller to still hold a participant slot here. A hosted
      // game can re-surface on a later delete call (we leave games.userId
      // intact), but once the slot is detached the caller is no longer a
      // real player in it, so skip — this keeps repeat calls idempotent and
      // stops a detached caller from re-mutating a shared game.
      const myPart = participants.find((p) => p.userId === user.id);
      if (!myPart) continue;
      const [game] = await tx
        .select({ winner: gamesTable.winner, gameState: gamesTable.gameState })
        .from(gamesTable)
        .where(eq(gamesTable.id, gameId));
      if (!game) continue;

      const gs = (game.gameState ?? {}) as Record<string, unknown>;
      const players = Array.isArray(gs["players"])
        ? (gs["players"] as Array<Record<string, unknown>>)
        : [];
      const shotLog = Array.isArray(gs["shotLog"])
        ? (gs["shotLog"] as Array<Record<string, unknown>>)
        : [];

      // The caller's name in this game, taken from their participant slot.
      const myName = myPart.displayName;

      // Build a collision-safe placeholder against every OTHER name present
      // (gameState players + participant slots).
      const otherNames = new Set<string>();
      for (const p of players) {
        const n = p["name"];
        if (typeof n === "string" && n !== myName) otherNames.add(n);
      }
      for (const p of participants) {
        if (p.userId !== user.id) otherNames.add(p.displayName);
      }
      const anonName = uniqueAnonName(otherNames);

      // Rewrite every occurrence of the caller's name, consistently.
      for (const p of players) {
        if (p["name"] === myName) p["name"] = anonName;
      }
      for (const e of shotLog) {
        if (e["playerName"] === myName) e["playerName"] = anonName;
      }
      if (gs["winner"] === myName) gs["winner"] = anonName;
      const newWinner = game.winner === myName ? anonName : game.winner;

      await tx
        .update(gamesTable)
        .set({ gameState: gs, winner: newWinner })
        .where(eq(gamesTable.id, gameId));

      // Detach the caller from this game so it leaves their history/stats/
      // export, and stamp the placeholder on their (now ownerless) slot.
      await tx
        .update(gameParticipantsTable)
        .set({ userId: null, displayName: anonName })
        .where(
          and(
            eq(gameParticipantsTable.gameId, gameId),
            eq(gameParticipantsTable.slotIndex, myPart.slotIndex),
          ),
        );

      anonymizedGames += 1;
    }

    return { deletedGames, anonymizedGames };
  });

  // Bust the user's cached personal stats so /stats recomputes now.
  clearUserStatsCache(user.id);

  req.log.info(
    { userId: user.id, ...result },
    "Deleted/anonymized game data for user",
  );
  res.json(
    DeleteMyGameDataResponse.parse({
      deleted: true,
      deletedGames: result.deletedGames,
      anonymizedGames: result.anonymizedGames,
    }),
  );
});

export default router;
