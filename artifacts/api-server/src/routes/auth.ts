import { Router, type IRouter } from "express";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  GetMeResponse,
  UpdateScreenNameBody,
  UpdateScreenNameResponse,
  UpdateProfileThemeBody,
  UpdateProfileThemeResponse,
} from "@workspace/api-zod";
import { getVerifiedSubject, getOrCreateUser, needsOnboarding } from "../lib/auth";
import { computeEntitlement, getActivePasses } from "../lib/entitlement";
import { normalizeProfileTheme } from "../lib/profileBackground";
import { resolveUserProfileBackground } from "../lib/userProfileBackground";
import { resolveLeaderboard, clearLeaderboardCache } from "../lib/stats";
import type { User } from "@workspace/db";

// Custom screen names are a Lifetime-pass perk. Admins are treated as effective
// Lifetime holders, so resolve through the entitlement (which synthesizes a
// Lifetime pass for admins) rather than querying real passes directly.
async function hasLifetimePerk(user: User): Promise<boolean> {
  const entitlement = await computeEntitlement(user);
  return entitlement.isAdmin || entitlement.activePass?.isLifetime === true;
}

const router: IRouter = Router();

router.get("/auth/me", async (req, res): Promise<void> => {
  const verified = await getVerifiedSubject(req);
  if (!verified) {
    res.json(
      GetMeResponse.parse({
        signedIn: false,
        needsOnboarding: false,
        entitlement: { tier: "public", hasActivePass: false, historyVisibleLimit: 0, isAdmin: false },
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
  // The concrete artwork the profile resolves to right now, so the Theme picker
  // can preselect it when the stored preference is still "auto".
  const profileBackground = await resolveUserProfileBackground({
    userId: user.id,
    email: user.email,
    profileTheme: user.profileTheme,
  });
  // The caller's own standing in the all-time global BPM ranking (shares the
  // 1-hour leaderboard cache, so this is a cheap lookup in the common case).
  // Screen names are canonical + unique, so they key a row to a single user.
  // Omitted when the caller has too few qualifying games to be ranked.
  const globalRanking = await resolveLeaderboard("all");
  const globalStanding = globalRanking.find((r) => r.screenName === user.screenName);
  res.json(
    GetMeResponse.parse({
      signedIn: true,
      needsOnboarding: needsOnboarding(user),
      account: {
        id: user.id,
        screenName: user.screenName,
        email: user.email,
        createdAt: user.createdAt,
        profileTheme: normalizeProfileTheme(user.profileTheme),
        profileBackground,
      },
      entitlement,
      passes,
      ...(globalStanding ? { globalStanding } : {}),
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
  if (!(await hasLifetimePerk(user))) {
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
      profileTheme: normalizeProfileTheme(updated.profileTheme),
      profileBackground: await resolveUserProfileBackground({
        userId: updated.id,
        email: updated.email,
        profileTheme: updated.profileTheme,
      }),
    }),
  );
});

// Watch-profile background theme. Like custom screen names, this is a Lifetime
// perk (admins included). "auto" clears the override (stored as NULL) so the
// artwork derives from the player's pass; any other value is stored verbatim.
router.patch("/auth/profile-theme", async (req, res): Promise<void> => {
  const parsed = UpdateProfileThemeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!(await hasLifetimePerk(user))) {
    res.status(403).json({
      error: "Profile themes are a Lifetime pass perk. Upgrade to customise.",
    });
    return;
  }
  const stored = parsed.data.profileTheme === "auto" ? null : parsed.data.profileTheme;
  const rows = await db
    .update(usersTable)
    .set({ profileTheme: stored })
    .where(eq(usersTable.id, user.id))
    .returning();
  const updated = rows[0];
  // A theme change updates the player's card colour on every leaderboard window;
  // drop all windows so the next request recomputes with the new profileBackground
  // rather than serving a stale (possibly wrong-coloured) cached ranking.
  clearLeaderboardCache();
  res.json(
    UpdateProfileThemeResponse.parse({
      id: updated.id,
      screenName: updated.screenName,
      email: updated.email,
      createdAt: updated.createdAt,
      profileTheme: normalizeProfileTheme(updated.profileTheme),
      profileBackground: await resolveUserProfileBackground({
        userId: updated.id,
        email: updated.email,
        profileTheme: updated.profileTheme,
      }),
    }),
  );
});

export default router;
