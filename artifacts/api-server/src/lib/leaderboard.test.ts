import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, gamesTable, type User } from "@workspace/db";
import {
  resolveLeaderboard,
  resolveAdminLeaderboard,
  clearLeaderboardCache,
  type AdminLeaderboardRow,
} from "./stats";
import {
  createUser,
  seedGame,
  seedParticipant,
  finalizeSeededGame,
  cleanup,
} from "../test/factories";

// DB-backed tests for the reworked leaderboard ranking (composite score:
// accuracy-weighted, trust-weighted pace; best-N of >= 2 qualifying games; a
// separate 9-ball board with a pocketed-ball floor; and the admin-only view
// that exposes the hidden score / trust / provisional signals).
//
// Each game is built with a hand-rolled shotLog so BPM and accuracy are
// deterministic. Shot timestamps are anchored at the game's startedAt (which is
// also the host participant's statsStartAt) so they pass the per-player time
// window filter, and 8-ball games are patched with the qualifying ruleSet so
// they clear the competitive gate regardless of the wall clock.

const HOUR = 3_600_000;

interface Shot {
  type: string;
  playerName: string;
  ball?: number;
  isFoul?: boolean;
  timestamp: number;
}

/**
 * Build a single player's shotLog: `misses` missed shots followed by `sinks`
 * pocketed balls evenly spread from `base` to `base + spanMs`. Misses are
 * listed first so the final array entry is always a sink, keeping the BPM
 * elapsed window (first sink → last entry) equal to `spanMs`.
 */
function shots(name: string, sinks: number, misses: number, spanMs: number, base: number): Shot[] {
  const log: Shot[] = [];
  for (let i = 0; i < misses; i++) {
    log.push({ type: "miss", playerName: name, timestamp: base });
  }
  for (let i = 0; i < sinks; i++) {
    const t = sinks === 1 ? base : base + Math.round((i / (sinks - 1)) * spanMs);
    log.push({ type: "sink", playerName: name, ball: i + 1, timestamp: t });
  }
  return log;
}

interface GameOpts {
  name: string;
  sinks: number;
  misses?: number;
  /** Minutes from first to last sink (controls BPM). Default 1 (so BPM = sinks). */
  spanMin?: number;
  /** When true, add a second registered participant so the game reads "trusted". */
  trusted?: boolean;
}

async function seedRankedGame(
  host: User,
  gameType: "8ball" | "9ball",
  opts: GameOpts,
): Promise<void> {
  const base = Date.now() - 2 * HOUR;
  const spanMs = (opts.spanMin ?? 1) * 60_000;
  const log = shots(opts.name, opts.sinks, opts.misses ?? 0, spanMs, base);
  const g = await seedGame(host.id, {
    gameType,
    maxPlayers: 2,
    hostName: opts.name,
    shotLog: log,
    startedAt: new Date(base),
    endedAt: new Date(base + spanMs + 60_000),
  });
  if (gameType === "8ball") {
    // 8-ball requires the standard competitive ruleSet to qualify.
    await db
      .update(gamesTable)
      .set({
        gameState: { ...(g.gameState as Record<string, unknown>), ruleSet: "open-through-break" },
      })
      .where(eq(gamesTable.id, g.id));
  }
  if (opts.trusted) {
    const opp = await createUser();
    await seedParticipant(g.id, 1, { userId: opp.id, displayName: `Opp_${opp.id.slice(0, 6)}` });
  }
  // Distill the fully-assembled game into its authoritative summaries +
  // discriminator columns (the leaderboard reads those, not the shotLog).
  await finalizeSeededGame(g.id);
}

beforeEach(() => {
  clearLeaderboardCache();
});

afterEach(async () => {
  clearLeaderboardCache();
  await cleanup();
});

describe("leaderboard ranking — reward floor", () => {
  it("ranks a player after 2 qualifying games but not after only 1", async () => {
    const ranked = await createUser();
    await seedRankedGame(ranked, "8ball", { name: ranked.screenName, sinks: 4, trusted: true });
    await seedRankedGame(ranked, "8ball", { name: ranked.screenName, sinks: 4, trusted: true });

    const oneGame = await createUser();
    await seedRankedGame(oneGame, "8ball", { name: oneGame.screenName, sinks: 4, trusted: true });

    clearLeaderboardCache();
    const board = await resolveLeaderboard("8ball", "all");

    expect(board.some((r) => r.screenName === ranked.screenName)).toBe(true);
    expect(board.some((r) => r.screenName === oneGame.screenName)).toBe(false);

    // Public rows must NEVER carry the hidden anti-cheat signals (toPublicRow
    // strips them) — those live only on the admin board.
    const row = board.find((r) => r.screenName === ranked.screenName)!;
    expect(row).not.toHaveProperty("score");
    expect(row).not.toHaveProperty("trustedGames");
    expect(row).not.toHaveProperty("provisional");
  });
});

describe("leaderboard ranking — accuracy weighting", () => {
  it("ranks an accurate player above a sloppy one at equal pace", async () => {
    // Both average BPM ~4 (4 sinks over 1 min). Alice never misses (100%);
    // Bob misses as often as he sinks (50%). Accuracy-weighting must put Alice
    // ahead despite identical raw pace.
    const alice = await createUser();
    await seedRankedGame(alice, "8ball", { name: alice.screenName, sinks: 4, misses: 0, trusted: true });
    await seedRankedGame(alice, "8ball", { name: alice.screenName, sinks: 4, misses: 0, trusted: true });

    const bob = await createUser();
    await seedRankedGame(bob, "8ball", { name: bob.screenName, sinks: 4, misses: 4, trusted: true });
    await seedRankedGame(bob, "8ball", { name: bob.screenName, sinks: 4, misses: 4, trusted: true });

    clearLeaderboardCache();
    const board = await resolveLeaderboard("8ball", "all");
    const aRank = board.find((r) => r.screenName === alice.screenName)?.rank;
    const bRank = board.find((r) => r.screenName === bob.screenName)?.rank;

    expect(aRank).toBeDefined();
    expect(bRank).toBeDefined();
    expect(aRank!).toBeLessThan(bRank!);
  });
});

describe("leaderboard ranking — trust weighting", () => {
  it("ranks a player above an otherwise-identical guest-only player", async () => {
    // Identical pace + perfect accuracy; the only difference is opponent trust.
    const trusted = await createUser();
    await seedRankedGame(trusted, "8ball", { name: trusted.screenName, sinks: 4, trusted: true });
    await seedRankedGame(trusted, "8ball", { name: trusted.screenName, sinks: 4, trusted: true });

    const guesty = await createUser();
    await seedRankedGame(guesty, "8ball", { name: guesty.screenName, sinks: 4, trusted: false });
    await seedRankedGame(guesty, "8ball", { name: guesty.screenName, sinks: 4, trusted: false });

    clearLeaderboardCache();
    const board = await resolveLeaderboard("8ball", "all");
    const tRank = board.find((r) => r.screenName === trusted.screenName)?.rank;
    const gRank = board.find((r) => r.screenName === guesty.screenName)?.rank;

    expect(tRank).toBeDefined();
    expect(gRank).toBeDefined();
    expect(tRank!).toBeLessThan(gRank!);
  });
});

describe("leaderboard ranking — mode separation", () => {
  it("keeps 8-ball and 9-ball boards independent", async () => {
    const eight = await createUser();
    await seedRankedGame(eight, "8ball", { name: eight.screenName, sinks: 4, trusted: true });
    await seedRankedGame(eight, "8ball", { name: eight.screenName, sinks: 4, trusted: true });

    const nine = await createUser();
    await seedRankedGame(nine, "9ball", { name: nine.screenName, sinks: 4, trusted: true });
    await seedRankedGame(nine, "9ball", { name: nine.screenName, sinks: 4, trusted: true });

    clearLeaderboardCache();
    const board8 = await resolveLeaderboard("8ball", "all");
    const board9 = await resolveLeaderboard("9ball", "all");

    expect(board8.some((r) => r.screenName === eight.screenName)).toBe(true);
    expect(board8.some((r) => r.screenName === nine.screenName)).toBe(false);
    expect(board9.some((r) => r.screenName === nine.screenName)).toBe(true);
    expect(board9.some((r) => r.screenName === eight.screenName)).toBe(false);
  });
});

describe("leaderboard ranking — 9-ball pocketed-ball floor", () => {
  it("drops 9-ball games below the pocketed-ball floor", async () => {
    // One qualifying game (4 sinks) + one sub-floor game (2 sinks). The
    // sub-floor game must be skipped, leaving only 1 qualifying game, so the
    // player falls under the 2-game reward floor and is absent from the board.
    const player = await createUser();
    await seedRankedGame(player, "9ball", { name: player.screenName, sinks: 4, trusted: true });
    await seedRankedGame(player, "9ball", { name: player.screenName, sinks: 2, trusted: true });

    clearLeaderboardCache();
    const board = await resolveLeaderboard("9ball", "all");
    expect(board.some((r) => r.screenName === player.screenName)).toBe(false);
  });

  it("counts a 9-ball game at or above the pocketed-ball floor", async () => {
    const player = await createUser();
    await seedRankedGame(player, "9ball", { name: player.screenName, sinks: 3, trusted: true });
    await seedRankedGame(player, "9ball", { name: player.screenName, sinks: 3, trusted: true });

    clearLeaderboardCache();
    const board = await resolveLeaderboard("9ball", "all");
    expect(board.some((r) => r.screenName === player.screenName)).toBe(true);
  });
});

describe("leaderboard ranking — implausible-pace cap", () => {
  it("drops ultra-fast (rushed / mis-logged) games as outliers", async () => {
    // A player whose only games are rushed flukes (14 sinks in 1 min = 14 BPM,
    // above the ~12 plausible ceiling) must have BOTH games dropped, leaving
    // them under the 2-game reward floor and off the board. Under the old loose
    // cap of 60 these would have qualified and vaulted them to the top.
    const rusher = await createUser();
    await seedRankedGame(rusher, "8ball", { name: rusher.screenName, sinks: 14, trusted: true });
    await seedRankedGame(rusher, "8ball", { name: rusher.screenName, sinks: 14, trusted: true });

    clearLeaderboardCache();
    const board = await resolveLeaderboard("8ball", "all");
    expect(board.some((r) => r.screenName === rusher.screenName)).toBe(false);
  });

  it("keeps a genuinely fast but plausible game", async () => {
    // 8 sinks in 1 min = 8 BPM — fast but under the ceiling, so it still counts.
    const fast = await createUser();
    await seedRankedGame(fast, "8ball", { name: fast.screenName, sinks: 8, trusted: true });
    await seedRankedGame(fast, "8ball", { name: fast.screenName, sinks: 8, trusted: true });

    clearLeaderboardCache();
    const board = await resolveLeaderboard("8ball", "all");
    expect(board.some((r) => r.screenName === fast.screenName)).toBe(true);
  });
});

describe("admin leaderboard — hidden signals", () => {
  it("exposes score, trustedGames and the provisional thin-sample flag", async () => {
    const provisionalPlayer = await createUser();
    // 2 trusted games → ranked, but under the 5-game "established" bar.
    await seedRankedGame(provisionalPlayer, "8ball", { name: provisionalPlayer.screenName, sinks: 4, trusted: true });
    await seedRankedGame(provisionalPlayer, "8ball", { name: provisionalPlayer.screenName, sinks: 4, trusted: true });

    const establishedPlayer = await createUser();
    // 5 trusted games → established (not provisional).
    for (let i = 0; i < 5; i++) {
      await seedRankedGame(establishedPlayer, "8ball", { name: establishedPlayer.screenName, sinks: 4, trusted: true });
    }

    clearLeaderboardCache();
    const rows: AdminLeaderboardRow[] = await resolveAdminLeaderboard("8ball", "all");

    const prov = rows.find((r) => r.screenName === provisionalPlayer.screenName);
    const est = rows.find((r) => r.screenName === establishedPlayer.screenName);

    expect(prov).toBeDefined();
    expect(est).toBeDefined();

    // Hidden signals are present and well-formed.
    expect(typeof prov!.score).toBe("number");
    expect(prov!.score).toBeGreaterThan(0);
    expect(prov!.trustedGames).toBe(2);
    expect(prov!.provisional).toBe(true);

    expect(est!.trustedGames).toBe(5);
    expect(est!.provisional).toBe(false);
  });

  it("flags a guest-only game as untrusted in trustedGames", async () => {
    const player = await createUser();
    await seedRankedGame(player, "8ball", { name: player.screenName, sinks: 4, trusted: true });
    await seedRankedGame(player, "8ball", { name: player.screenName, sinks: 4, trusted: false });

    clearLeaderboardCache();
    const rows = await resolveAdminLeaderboard("8ball", "all");
    const me = rows.find((r) => r.screenName === player.screenName);

    expect(me).toBeDefined();
    expect(me!.gamesPlayed).toBe(2);
    expect(me!.trustedGames).toBe(1);
  });
});

describe("shark board — win gate vs scorable games", () => {
  /**
   * Seed a finished solo Shark-mode WIN for `host`. `sinks: 1` produces a
   * one-pocket instant win whose stamped BPM is 0 (sub-ms elapsed) — a real
   * production shape that must still count toward the 5-win entry gate even
   * though the pace filter drops it from the scored set.
   */
  async function seedSharkWin(host: User, sinks: number): Promise<void> {
    const base = Date.now() - 2 * HOUR;
    const spanMs = 60_000;
    const log = shots(host.screenName, sinks, 0, spanMs, base);
    const g = await seedGame(host.id, {
      gameType: "8ball",
      maxPlayers: 1,
      hostName: host.screenName,
      shotLog: log,
      startedAt: new Date(base),
      endedAt: new Date(base + spanMs + 60_000),
      winner: host.screenName,
    });
    await db
      .update(gamesTable)
      .set({
        gameState: { ...(g.gameState as Record<string, unknown>), sharkAggression: "normal" },
      })
      .where(eq(gamesTable.id, g.id));
    await finalizeSeededGame(g.id);
  }

  it("ranks 5 wins even when one win has an unusable (0) BPM", async () => {
    const player = await createUser();
    // 4 scorable wins + 1 pace-less single-sink win = 5 wins total.
    for (let i = 0; i < 4; i++) await seedSharkWin(player, 4);
    await seedSharkWin(player, 1);

    const fourWins = await createUser();
    for (let i = 0; i < 4; i++) await seedSharkWin(fourWins, 4);

    clearLeaderboardCache();
    const board = await resolveLeaderboard("shark", "all");

    const me = board.find((r) => r.screenName === player.screenName);
    expect(me).toBeDefined();
    // gamesPlayed reports the WIN count (the gate), not just scorable games.
    expect(me!.gamesPlayed).toBe(5);

    expect(board.some((r) => r.screenName === fourWins.screenName)).toBe(false);
  });
});
