import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  computeEntitlement,
  HISTORY_LIMIT_FREE_ACCOUNT,
  LIFETIME_EXPIRES_AT,
} from "./entitlement";
import {
  createUser,
  seedPass,
  seedSubscription,
  cleanup,
} from "../test/factories";

const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(cleanup);

describe("computeEntitlement", () => {
  it("returns the public tier with zero history for anonymous users", async () => {
    const ent = await computeEntitlement(null);
    expect(ent.tier).toBe("public");
    expect(ent.hasActivePass).toBe(false);
    expect(ent.historyVisibleLimit).toBe(0);
  });

  it("caps a free signed-in account to 3 history entries", async () => {
    const user = await createUser();
    const ent = await computeEntitlement(user);
    expect(ent.tier).toBe("account");
    expect(ent.hasActivePass).toBe(false);
    expect(ent.historyVisibleLimit).toBe(HISTORY_LIMIT_FREE_ACCOUNT);
    // Lock the documented cap value so a silent change is caught.
    expect(HISTORY_LIMIT_FREE_ACCOUNT).toBe(3);
  });

  it("grants full access (no history cap) with an active pass", async () => {
    const user = await createUser();
    await seedPass(user.id, "day");
    const ent = await computeEntitlement(user);
    expect(ent.tier).toBe("pass");
    expect(ent.hasActivePass).toBe(true);
    expect(ent.historyVisibleLimit).toBeNull();
    expect(ent.activePass?.kind).toBe("day");
  });

  it("grants full access with an active subscription and no pass", async () => {
    const user = await createUser();
    await seedSubscription(user.id, { status: "active" });
    const ent = await computeEntitlement(user);
    expect(ent.tier).toBe("pass");
    expect(ent.historyVisibleLimit).toBeNull();
    // hasActivePass refers to passes specifically — a subscription does not
    // flip it, but it still grants the "pass" tier / unlimited history.
    expect(ent.hasActivePass).toBe(false);
    expect(ent.activeSubscription?.status).toBe("active");
  });

  it("keeps access when a subscription is set to cancel at period end", async () => {
    const user = await createUser();
    await seedSubscription(user.id, {
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date(Date.now() + 10 * DAY_MS),
    });
    const ent = await computeEntitlement(user);
    expect(ent.tier).toBe("pass");
    expect(ent.historyVisibleLimit).toBeNull();
    expect(ent.activeSubscription?.cancelAtPeriodEnd).toBe(true);
  });

  it("treats a subscription past its period end as inactive", async () => {
    const user = await createUser();
    await seedSubscription(user.id, {
      status: "active",
      currentPeriodEnd: new Date(Date.now() - 1000),
    });
    const ent = await computeEntitlement(user);
    expect(ent.tier).toBe("account");
    expect(ent.historyVisibleLimit).toBe(HISTORY_LIMIT_FREE_ACCOUNT);
  });

  it("treats a canceled-status subscription as inactive even within the period", async () => {
    const user = await createUser();
    await seedSubscription(user.id, {
      status: "canceled",
      currentPeriodEnd: new Date(Date.now() + 10 * DAY_MS),
    });
    const ent = await computeEntitlement(user);
    expect(ent.tier).toBe("account");
  });

  it("ignores an expired pass", async () => {
    const user = await createUser();
    await seedPass(user.id, "day", {
      startedAt: new Date(Date.now() - 2 * DAY_MS),
      durationSeconds: 24 * 60 * 60,
    });
    const ent = await computeEntitlement(user);
    expect(ent.tier).toBe("account");
    expect(ent.historyVisibleLimit).toBe(HISTORY_LIMIT_FREE_ACCOUNT);
  });

  it("treats a lifetime pass (null duration) as active", async () => {
    const user = await createUser();
    await seedPass(user.id, "lifetime");
    const ent = await computeEntitlement(user);
    expect(ent.tier).toBe("pass");
    expect(ent.hasActivePass).toBe(true);
    expect(ent.activePass?.isLifetime).toBe(true);
    expect(ent.historyVisibleLimit).toBeNull();
  });

  it("sets isAdmin false for ordinary signed-in users", async () => {
    const user = await createUser();
    const ent = await computeEntitlement(user);
    expect(ent.isAdmin).toBe(false);
  });

  describe("admin allowlist", () => {
    const ADMIN_EMAIL = "boss@breakbpm.test";
    let prevEnv: string | undefined;

    beforeEach(() => {
      prevEnv = process.env.BREAKBPM_ADMIN_EMAILS;
      process.env.BREAKBPM_ADMIN_EMAILS = ADMIN_EMAIL;
    });

    afterEach(() => {
      if (prevEnv === undefined) delete process.env.BREAKBPM_ADMIN_EMAILS;
      else process.env.BREAKBPM_ADMIN_EMAILS = prevEnv;
    });

    it("treats an admin with no real pass as an effective Lifetime holder", async () => {
      const user = await createUser({ email: ADMIN_EMAIL });
      const ent = await computeEntitlement(user);
      expect(ent.isAdmin).toBe(true);
      expect(ent.tier).toBe("pass");
      expect(ent.hasActivePass).toBe(true);
      expect(ent.historyVisibleLimit).toBeNull();
      expect(ent.activePass?.isLifetime).toBe(true);
      expect(ent.activePass?.kind).toBe("lifetime");
      expect(ent.activePass?.expiresAt).toEqual(LIFETIME_EXPIRES_AT);
    });

    it("matches the allowlist case-insensitively", async () => {
      const user = await createUser({ email: ADMIN_EMAIL.toUpperCase() });
      const ent = await computeEntitlement(user);
      expect(ent.isAdmin).toBe(true);
    });

    it("prefers a real pass over the synthesized lifetime for admins", async () => {
      const user = await createUser({ email: ADMIN_EMAIL });
      await seedPass(user.id, "day");
      const ent = await computeEntitlement(user);
      expect(ent.isAdmin).toBe(true);
      expect(ent.activePass?.kind).toBe("day");
    });
  });
});
