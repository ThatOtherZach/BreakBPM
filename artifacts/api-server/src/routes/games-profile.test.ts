import { describe, it, expect, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, gamesTable } from "@workspace/db";

// The profile route is public (no auth), but games.ts still imports the auth
// lib at module load. Stub it so the suite never touches Clerk.
vi.mock("../lib/auth", () => ({
  getOrCreateUser: vi.fn(async () => null),
  getVerifiedSubject: vi.fn(async () => null),
}));

import gamesRouter from "./games";
import {
  createUser,
  seedPass,
  seedDiscountCode,
  seedGame,
  seedParticipant,
  finalizeSeededGame,
  setStaleSummary,
  cleanup,
} from "../test/factories";

function makeApp(): Express {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      info() {},
      warn() {},
      error() {},
    };
    next();
  });
  app.use("/api", gamesRouter);
  return app;
}

const app = makeApp();

/** Unique source IP per request → its own rate-limit bucket. */
function freshIp(): string {
  const o = () => Math.floor(Math.random() * 254) + 1;
  return `10.${o()}.${o()}.${o()}`;
}

/** Fetch a public profile by screen name. */
async function fetchProfile(name: string): Promise<request.Response> {
  return request(app)
    .get("/api/games/profile")
    .set("X-Forwarded-For", freshIp())
    .query({ name });
}

/** Overwrite a user's stored profile-theme preference. */
async function setTheme(userId: string, theme: string | null): Promise<void> {
  await db.update(usersTable).set({ profileTheme: theme }).where(eq(usersTable.id, userId));
}

/** Seed a redeemed-card pass: a discount code carrying a stored artwork variant
 * plus an active pass whose sourceRef points back at that code. */
async function seedCardPass(
  userId: string,
  code: string,
  variant: string,
  kind: Parameters<typeof seedPass>[1] = "lifetime",
  passOpts: Parameters<typeof seedPass>[2] = {},
): Promise<void> {
  await seedDiscountCode(code, kind, { backgroundVariant: variant });
  await seedPass(userId, kind, { source: "discount_code", sourceRef: code, ...passOpts });
}

afterEach(async () => {
  vi.clearAllMocks();
  await cleanup();
});

describe("GET /games/profile — profileBackground wiring", () => {
  it("returns the stored card artwork for a paid host with a card-redeemed pass", async () => {
    const host = await createUser();
    // The redeem card stored 'hustler' at mint time; the profile must wear
    // exactly that — no derivation from the code string.
    await seedCardPass(host.id, "CARD-TEST", "hustler");

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBe("hustler");
  });

  it("returns a null background for a paid host whose pass carried no card", async () => {
    const host = await createUser();
    // A 'grant' pass has no sourceRef (no card) → nothing stored → plain.
    await seedPass(host.id, "lifetime");

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBeNull();
  });

  it("returns null when the card was minted without artwork", async () => {
    const host = await createUser();
    // A discount-code pass whose code stored no artwork (includeArtwork off).
    await seedDiscountCode("CARD-NOART", "lifetime", { backgroundVariant: null });
    await seedPass(host.id, "lifetime", { source: "discount_code", sourceRef: "CARD-NOART" });

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBeNull();
  });

  it("a redeemed-card pass applies its stored artwork even alongside a longer non-card pass", async () => {
    const host = await createUser();
    // A redeemed card (discount-code pass) carries stored artwork...
    await seedCardPass(host.id, "CARD-X", "pool-player", "month", {
      durationSeconds: 30 * 24 * 60 * 60,
    });
    // ...and a longer-expiring non-card grant must NOT suppress it.
    await seedPass(host.id, "lifetime"); // grant, no card

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBe("pool-player");
  });

  it("returns a null background for an unpaid host", async () => {
    const host = await createUser();

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBeNull();
  });

  describe("Theme override path (paid host)", () => {
    it("'none' → null background", async () => {
      const host = await createUser();
      await seedPass(host.id, "lifetime");
      await setTheme(host.id, "none");

      const res = await fetchProfile(host.screenName);

      expect(res.status).toBe(200);
      expect(res.body.profileBackground).toBeNull();
    });

    it("an explicit variant → that variant (beats the stored card variant)", async () => {
      const host = await createUser();
      await seedCardPass(host.id, "CARD-OVR", "shark");
      await setTheme(host.id, "hustler");

      const res = await fetchProfile(host.screenName);

      expect(res.status).toBe(200);
      expect(res.body.profileBackground).toBe("hustler");
    });

    it("'auto' → the stored artwork of an active redeemed-card pass", async () => {
      const host = await createUser();
      await seedCardPass(host.id, "CARD-TEST", "shark");
      await setTheme(host.id, "auto");

      const res = await fetchProfile(host.screenName);

      expect(res.status).toBe(200);
      expect(res.body.profileBackground).toBe("shark");
    });
  });
});

describe("GET /games/profile — auto-earned theme from joined games", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("a registered player earns hustler from games they JOINED (not hosted) and won", async () => {
    const host = await createUser();
    const joiner = await createUser();
    const joinerName = "Joiner";
    // 10 completed standard 8-ball games hosted by someone else; the joiner took
    // a non-host seat and won every one. They hosted none of them — earning here
    // proves participation (joins), not just hosting, accrues toward the theme.
    for (let i = 0; i < 10; i++) {
      const g = await seedGame(host.id, {
        gameType: "8ball",
        maxPlayers: 2,
        hostName: "Host",
        winner: joinerName,
        endedAt: new Date(Date.now() - (i + 1) * DAY),
      });
      await seedParticipant(g.id, 1, {
        userId: joiner.id,
        displayName: joinerName,
      });
    }

    const res = await fetchProfile(joiner.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBe("hustler");
  });

  it("a registered host still earns hustler from games they HOSTED and won", async () => {
    const host = await createUser();
    const hostName = "Champ";
    for (let i = 0; i < 10; i++) {
      await seedGame(host.id, {
        gameType: "8ball",
        maxPlayers: 2,
        hostName,
        winner: hostName,
        endedAt: new Date(Date.now() - (i + 1) * DAY),
      });
    }

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.profileBackground).toBe("hustler");
  });

  it("does not earn when the joined wins are all older than the 30-day window", async () => {
    const host = await createUser();
    const joiner = await createUser();
    const joinerName = "StaleJoiner";
    for (let i = 0; i < 10; i++) {
      const g = await seedGame(host.id, {
        gameType: "8ball",
        maxPlayers: 2,
        hostName: "Host",
        winner: joinerName,
        endedAt: new Date(Date.now() - (i + 31) * DAY), // 31–40 days ago
      });
      await seedParticipant(g.id, 1, {
        userId: joiner.id,
        displayName: joinerName,
      });
    }

    const res = await fetchProfile(joiner.screenName);

    expect(res.status).toBe(200);
    expect(res.body.profileBackground).toBeNull();
  });
});

describe("GET /games/profile — guest-name redaction on the public profile", () => {
  const DAY = 24 * 60 * 60 * 1000;

  /** Seed a finished 2P 8-ball game hosted by `host` (slot 0) against a slot-1
   * opponent, writing a slot-ordered players snapshot + a pocketing shot log
   * into gameState so the profile read resolves the opponent and shot log. */
  async function seedVersusGame(
    host: { id: string },
    opts: {
      hostPlayerName: string;
      opponentName: string;
      // Server-set participant displayName (the canonical account label). When
      // omitted it mirrors `opponentName`; set it DIFFERENT from `opponentName`
      // to simulate a host who tampered the client gameState label for a slot
      // that is nonetheless a real registered account.
      opponentCanonicalName?: string;
      opponentUserId?: string | null;
      winner: string;
      shotLog: Array<{ ball: number; playerName: string }>;
    },
  ): Promise<void> {
    const g = await seedGame(host.id, {
      gameType: "8ball",
      maxPlayers: 2,
      hostName: opts.hostPlayerName,
      winner: opts.winner,
      endedAt: new Date(Date.now() - DAY),
    });
    await db
      .update(gamesTable)
      .set({
        gameState: {
          gameType: "8ball",
          startedAt: new Date(Date.now() - DAY).toISOString(),
          shareCode: g.shareCode,
          players: [{ name: opts.hostPlayerName }, { name: opts.opponentName }],
          shotLog: opts.shotLog,
        },
      })
      .where(eq(gamesTable.id, g.id));
    await seedParticipant(g.id, 1, {
      userId: opts.opponentUserId ?? null,
      displayName: opts.opponentCanonicalName ?? opts.opponentName,
    });
  }

  it("hides a typed guest opponent's name (opponent, winner, shot log) while keeping the shot log", async () => {
    const host = await createUser();
    await seedVersusGame(host, {
      hostPlayerName: "Champ",
      opponentName: "GuestBob",
      opponentUserId: null, // typed guest — no account
      winner: "GuestBob",
      shotLog: [
        { ball: 1, playerName: "Champ" },
        { ball: 2, playerName: "Champ" },
        { ball: 3, playerName: "GuestBob" },
      ],
    });

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    const game = res.body.games[0];
    // The guest opponent's name must not leak through opponent...
    expect(game.opponent).toBeNull();
    expect(game.opponentRegistered).toBe(false);
    // ...nor through winner...
    expect(game.winner).toBeNull();
    // ...nor through the shot-log shooter names.
    const players = game.pocketSequence.map((p: { player: string }) => p.player);
    expect(players).not.toContain("Champ");
    expect(players).not.toContain("GuestBob");
    // The shot log itself is preserved (3 balls), and run-grouping survives:
    // each distinct shooter maps to its own stable token.
    expect(game.pocketSequence.map((p: { ball: number }) => p.ball)).toEqual([1, 2, 3]);
    expect(new Set(players).size).toBe(2);
  });

  it("keeps a registered opponent's username visible on the public profile", async () => {
    const host = await createUser();
    const opp = await createUser();
    await seedVersusGame(host, {
      hostPlayerName: "Champ",
      opponentName: "RegOpp",
      opponentUserId: opp.id, // registered account
      winner: "Champ",
      shotLog: [
        { ball: 1, playerName: "Champ" },
        { ball: 2, playerName: "RegOpp" },
      ],
    });

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    const game = res.body.games[0];
    expect(game.opponent).toBe("RegOpp");
    expect(game.opponentRegistered).toBe(true);
  });

  it("shows a registered opponent's canonical account name, never a spoofed gameState label", async () => {
    const host = await createUser();
    const opp = await createUser();
    const SPOOF = "ZZSpoofedSecretName";
    await seedVersusGame(host, {
      hostPlayerName: "Champ",
      // Attacker-controlled client gameState label for a slot that IS a real
      // registered account (e.g. a host who hand-crafted the saved snapshot)...
      opponentName: SPOOF,
      // ...but the server-set participant displayName is the canonical handle.
      opponentCanonicalName: opp.screenName,
      opponentUserId: opp.id,
      winner: "Champ",
      shotLog: [
        { ball: 1, playerName: "Champ" },
        { ball: 2, playerName: SPOOF },
      ],
    });

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    const game = res.body.games[0];
    // The displayed opponent is the canonical server-set label, not the client
    // gameState name — even though the slot is genuinely registered.
    expect(game.opponent).toBe(opp.screenName);
    expect(game.opponentRegistered).toBe(true);
    // The spoofed free text never appears ANYWHERE in the serialized response
    // (not as opponent, winner, nor a shot-log shooter name).
    expect(JSON.stringify(res.body)).not.toContain(SPOOF);
  });

  it("omits the share code and leaks no guest string anywhere in the serialized body", async () => {
    const host = await createUser();
    await seedVersusGame(host, {
      hostPlayerName: "HostHubertXY",
      opponentName: "GuestZaraXY",
      opponentUserId: null, // typed guest
      winner: "GuestZaraXY",
      shotLog: [
        { ball: 1, playerName: "HostHubertXY" },
        { ball: 2, playerName: "GuestZaraXY" },
      ],
    });

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    const game = res.body.games[0];
    // /games/state is public-by-code and returns an ended game's full gameState
    // (typed guest names included), so the public profile must not publish the
    // code that unlocks it.
    expect(game.shareCode).toBeUndefined();
    // Defense in depth: neither the subject's own typed gameState label nor the
    // guest opponent's name survives anywhere in the response body.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("HostHubertXY");
    expect(body).not.toContain("GuestZaraXY");
  });

  it("preserves the Shark sentinel in winner and the shot log on a public profile", async () => {
    const host = await createUser();
    const g = await seedGame(host.id, {
      gameType: "8ball",
      maxPlayers: 1,
      hostName: "Champ",
      winner: "Shark",
      endedAt: new Date(Date.now() - DAY),
    });
    await db
      .update(gamesTable)
      .set({
        gameState: {
          gameType: "8ball",
          startedAt: new Date(Date.now() - DAY).toISOString(),
          shareCode: g.shareCode,
          sharkAggression: "normal",
          players: [{ name: "Champ" }],
          shotLog: [
            { ball: 1, playerName: "Champ" },
            { ball: 2, playerName: "Shark" },
          ],
        },
      })
      .where(eq(gamesTable.id, g.id));

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    const game = res.body.games[0];
    // Shark games have no human opponent...
    expect(game.opponent).toBeNull();
    // ...the Shark sentinel survives so the card still renders the verdict...
    expect(game.winner).toBe("Shark");
    const players = game.pocketSequence.map((p: { player: string }) => p.player);
    // ...and stays intact in the shot log (drives the Shark-steal dimming),
    // while the human shooter's typed name is tokenized away.
    expect(players).toContain("Shark");
    expect(players).not.toContain("Champ");
  });
});

describe("GET /games/profile — per-game defense fields", () => {
  it("returns the subject's own safety counts for a finalized (v2) game", async () => {
    const host = await createUser();
    const base = Date.now() - 60 * 60 * 1000;
    // Two safeties by the host: the first HELD (the opponent's very next shot
    // pocketed nothing), the second was ANSWERED (the opponent sank a ball).
    const g = await seedGame(host.id, {
      hostName: host.screenName,
      shotLog: [
        { type: "safety", playerName: host.screenName, timestamp: base },
        { type: "miss", playerName: "Guest", timestamp: base + 10_000 },
        { type: "safety", playerName: host.screenName, timestamp: base + 20_000 },
        { type: "sink", playerName: "Guest", ball: 3, timestamp: base + 30_000 },
      ],
      startedAt: new Date(base),
      endedAt: new Date(base + 60_000),
      winner: "Guest",
    });
    await seedParticipant(g.id, 1, { displayName: "Guest" });
    await finalizeSeededGame(g.id);

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    const row = res.body.games.find((x: { id: string }) => x.id === g.id);
    expect(row).toBeDefined();
    expect(row.defenseSafeties).toBe(2);
    expect(row.defenseSuccesses).toBe(1);
    // The host's only shots this game were the two safeties — the DEF
    // denominator (successful-defense share of shots).
    expect(row.defenseShots).toBe(2);
  });

  it("omits all defense fields when the subject's summary is unreadable (no data ≠ 0)", async () => {
    const host = await createUser();
    const base = Date.now() - 60 * 60 * 1000;
    const g = await seedGame(host.id, {
      hostName: host.screenName,
      shotLog: [{ type: "safety", playerName: host.screenName, timestamp: base }],
      startedAt: new Date(base),
      endedAt: new Date(base + 60_000),
    });
    await finalizeSeededGame(g.id);
    // Force a FUTURE-version summary: unreadable, and deliberately NOT lifted
    // by the read-path self-heal (which only repairs versions BELOW current) —
    // exactly the rollback-window shape where defense data must read as
    // "absent", never as a fabricated 0%.
    await setStaleSummary(g.id);

    const res = await fetchProfile(host.screenName);

    expect(res.status).toBe(200);
    const row = res.body.games.find((x: { id: string }) => x.id === g.id);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("defenseSafeties");
    expect(row).not.toHaveProperty("defenseSuccesses");
    expect(row).not.toHaveProperty("defenseShots");
  });
});
