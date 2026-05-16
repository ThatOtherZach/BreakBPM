import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  GetMeResponse,
  UpdateScreenNameBody,
  UpdateScreenNameResponse,
} from "@workspace/api-zod";
import { authProvider, getOrCreateUser } from "../lib/auth";
import { computeEntitlement, getActivePasses } from "../lib/entitlement";

const router: IRouter = Router();

router.get("/auth/me", async (req, res): Promise<void> => {
  const identity = await authProvider.getIdentity(req);
  if (!identity) {
    res.json(
      GetMeResponse.parse({
        signedIn: false,
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
  const trimmed = parsed.data.screenName.trim();
  if (!trimmed) {
    res.status(400).json({ error: "Screen name required" });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ screenName: trimmed })
    .where(eq(usersTable.id, user.id))
    .returning();
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
