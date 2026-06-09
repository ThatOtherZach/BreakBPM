import { Router, type IRouter } from "express";
import { GetAppConfigResponse } from "@workspace/api-zod";
import { promoQrUrl } from "../lib/config";

const router: IRouter = Router();

router.get("/config", (_req, res) => {
  const data = GetAppConfigResponse.parse({ qrUrl: promoQrUrl() });
  res.json(data);
});

export default router;
