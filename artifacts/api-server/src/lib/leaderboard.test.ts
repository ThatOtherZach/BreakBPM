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
