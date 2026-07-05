import { Router, type IRouter } from "express";
import { count } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { GetAppConfigResponse } from "@workspace/api-zod";
import { promoQrUrl, storeUrl, bannedWords } from "../lib/config";

const router: IRouter = Router();

router.get("/config", async (_req, res) => {
  const [{ value: playersOnline }] = await db
    .select({ value: count() })
    .from(usersTable);

  const data = GetAppConfigResponse.parse({
    qrUrl: promoQrUrl(),
    storeUrl: storeUrl(),
    bannedWords: bannedWords(),
    playersOnline,
  });
  res.json(data);
});

export default router;
