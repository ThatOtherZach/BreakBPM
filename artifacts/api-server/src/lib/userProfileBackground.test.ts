import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  resolveUserProfileBackground,
  resolveUserProfileBackgrounds,
} from "./userProfileBackground";
import type { BackgroundVariant } from "./profileBackground";
import { createUser, seedPass, seedDiscountCode, cleanup } from "../test/factories";

// The leaderboard (batched) and the public /watch profile (single-user) paths
// MUST resolve every player's theme background identically. These tests pin the
// two helpers in lockstep across the key entitlement cases so a future change to
// one can't silently drift the leaderboard's colors away from the real profile.

const ADMIN_EMAIL = "profile-bg-admin-test@breakbpm.test";
let prevAdminEmails: string | undefined;

beforeAll(() => {
  prevAdminEmails = process.env.BREAKBPM_ADMIN_EMAILS;
  process.env.BREAKBPM_ADMIN_EMAILS = ADMIN_EMAIL;
});

afterAll(() => {
  if (prevAdminEmails === undefined) delete process.env.BREAKBPM_ADMIN_EMAILS;
  else process.env.BREAKBPM_ADMIN_EMAILS = prevAdminEmails;
});

afterEach(async () => {
  await cleanup();
});

/** Seed a redeemed-card pass: a discount code carrying stored artwork plus an
 * active pass whose sourceRef points back at that code. */
async function seedCardPass(
  userId: string,
  code: string,
  variant: string | null,
  passOpts: Parameters<typeof seedPass>[2] = {},
): Promise<void> {
  await seedDiscountCode(code, "lifetime", { backgroundVariant: variant });
  await seedPass(userId, "lifetime", {
    source: "discount_code",
    sourceRef: code,
    ...passOpts,
  });
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("resolveUserProfileBackgrounds (batched) ↔ resolveUserProfileBackground (single)", () => {
  it("produces identical results across every entitlement case, in one batch", async () => {
    // --- Fixture set: one user per key case. -----------------------------

    // 1) Unpaid: no pass at all → plain (null).
    const unpaid = await createUser();

    // 2) Paid via crypto (a 'purchase' pass) — no card → plain (null).
    const crypto = await createUser();
    await seedPass(crypto.id, "lifetime", { source: "purchase" });

    // 3) Paid via grant — no card → plain (null).
    const grant = await createUser();
    await seedPass(grant.id, "lifetime", { source: "grant" });

    // 4) Paid via a redeem card carrying artwork → the stored variant.
    const card = await createUser();
    await seedCardPass(card.id, "CARD-ART", "hustler");

    // 5) Multiple card passes: the most recently redeemed card with artwork
    //    wins (an older card carried 'shark', the newest 'pool-player').
    const multiCard = await createUser();
    await seedCardPass(multiCard.id, "CARD-OLD", "shark", {
      startedAt: new Date(Date.now() - 2 * DAY),
    });
    await seedCardPass(multiCard.id, "CARD-NEW", "pool-player", {
      startedAt: new Date(Date.now() - 1 * DAY),
    });

    // 6) Expired pass → treated as unpaid → plain (null), even with a card.
    const expired = await createUser();
    await seedCardPass(expired.id, "CARD-EXP", "shark", {
      startedAt: new Date(Date.now() - 10 * DAY),
      durationSeconds: 1 * DAY / 1000,
    });

    // 7) Future-dated pass (not yet started) → treated as unpaid → null.
    const future = await createUser();
    await seedCardPass(future.id, "CARD-FUT", "shark", {
      startedAt: new Date(Date.now() + 1 * DAY),
    });

    // 8) Admin with NO pass → effective Lifetime (paid) but no card → null.
    const admin = await createUser({ email: ADMIN_EMAIL });

    const fixtures: Array<{
      user: { id: string; email: string | null };
      theme: string | null;
      expected: BackgroundVariant | null;
    }> = [
      { user: unpaid, theme: null, expected: null },
      { user: crypto, theme: null, expected: null },
      { user: grant, theme: null, expected: null },
      { user: card, theme: null, expected: "hustler" },
      { user: multiCard, theme: null, expected: "pool-player" },
      { user: expired, theme: null, expected: null },
      { user: future, theme: null, expected: null },
      { user: admin, theme: null, expected: null },
    ];

    // Batched resolution (the leaderboard path) — one call for the whole set.
    const batched = await resolveUserProfileBackgrounds(
      fixtures.map((f) => ({
        userId: f.user.id,
        email: f.user.email,
        profileTheme: f.theme,
      })),
    );

    // Single-user resolution (the /watch profile path) for each fixture, then
    // assert the batched output matches it AND the expected value exactly.
    for (const f of fixtures) {
      const single = await resolveUserProfileBackground({
        userId: f.user.id,
        email: f.user.email,
        profileTheme: f.theme,
      });
      expect(single).toBe(f.expected);
      expect(batched.get(f.user.id)).toBe(f.expected);
      expect(batched.get(f.user.id)).toBe(single);
    }
  });

  it("matches the single-user path when an explicit theme override is set", async () => {
    // A paid card holder whose stored artwork is 'shark' but who picked an
    // explicit 'hustler' override — the override must win on both paths.
    const overridden = await createUser();
    await seedCardPass(overridden.id, "CARD-OVR", "shark");

    const single = await resolveUserProfileBackground({
      userId: overridden.id,
      email: overridden.email,
      profileTheme: "hustler",
    });
    const batched = await resolveUserProfileBackgrounds([
      { userId: overridden.id, email: overridden.email, profileTheme: "hustler" },
    ]);

    expect(single).toBe("hustler");
    expect(batched.get(overridden.id)).toBe("hustler");
    expect(batched.get(overridden.id)).toBe(single);
  });

  it("returns an empty map for an empty input set", async () => {
    const batched = await resolveUserProfileBackgrounds([]);
    expect(batched.size).toBe(0);
  });
});
