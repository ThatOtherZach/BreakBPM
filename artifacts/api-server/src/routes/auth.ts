import { Router, type IRouter } from "express";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  GetMeResponse,
  UpdateScreenNameBody,
  UpdateScreenNameResponse,
} from "@workspace/api-zod";
import { getVerifiedSubject, getOrCreateUser, needsOnboarding } from "../lib/auth";
import { computeEntitlement, getActivePasses } from "../lib/entitlement";

async function hasLifetimePass(userId: string): Promise<boolean> {
  const passes = await getActivePasses(userId);
  return passes.some((p) => p.isLifetime);
}

const router: IRouter = Router();

router.get("/auth/me", async (req, res): Promise<void> => {
  const verified = await getVerifiedSubject(req);
  if (!verified) {
    res.json(
      GetMeResponse.parse({
        signedIn: false,
        needsOnboarding: false,
        entitlement: { tier: "public", hasActivePass: false, historyVisibleLimit: 0 },
        passes: [],
      }),
    );
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(500).json({ error: "Failed to provision user" });
    return;
  }
  const entitlement = await computeEntitlement(user);
  const passes = await getActivePasses(user.id);
  res.json(
    GetMeResponse.parse({
      signedIn: true,
      needsOnboarding: needsOnboarding(user),
      account: {
        id: user.id,
        screenName: user.screenName,
        email: user.email,
        createdAt: user.createdAt,
      },
      entitlement,
      passes,
    }),
  );
});

router.patch("/auth/screen-name", async (req, res): Promise<void> => {
  const parsed = UpdateScreenNameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!(await hasLifetimePass(user.id))) {
    res.status(403).json({
      error: "Custom screen names are a Lifetime pass perk. Upgrade to customise.",
    });
    return;
  }
  const trimmed = parsed.data.screenName.trim();
  if (!trimmed) {
    res.status(400).json({ error: "Screen name required" });
    return;
  }
  // Screen names double as the public /watch/{name} handle, so they must be
  // URL-safe: letters, digits, underscore and hyphen only.
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(trimmed)) {
    res.status(400).json({
      error:
        "Use 2–30 characters: letters, numbers, hyphens or underscores only (no spaces or symbols).",
    });
    return;
  }
  // Enforce case-insensitive uniqueness (mirrors the DB unique index) so the
  // /watch/{name} handle always resolves to exactly one host. Exclude self so
  // re-saving the same name (or a case change) is allowed.
  const [clash] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        sql`lower(${usersTable.screenName}) = ${trimmed.toLowerCase()}`,
        ne(usersTable.id, user.id),
      ),
    )
    .limit(1);
  if (clash) {
    res.status(409).json({ error: "That name is already taken — try another." });
    return;
  }
  // Confirming the screen name also marks onboarding complete.
  let updated: typeof usersTable.$inferSelect;
  try {
    const rows = await db
      .update(usersTable)
      .set({ screenName: trimmed, onboardingCompletedAt: new Date() })
      .where(eq(usersTable.id, user.id))
      .returning();
    updated = rows[0];
  } catch (err) {
    // Fallback for the race where two requests pass the check at once: the DB
    // unique index rejects the loser with Postgres error 23505.
    if ((err as { code?: string })?.code === "23505") {
      res.status(409).json({ error: "That name is already taken — try another." });
      return;
    }
    throw err;
  }
  res.json(
    UpdateScreenNameResponse.parse({
      id: updated.id,
      screenName: updated.screenName,
      email: updated.email,
      createdAt: updated.createdAt,
    }),
  );
});

export default router;
