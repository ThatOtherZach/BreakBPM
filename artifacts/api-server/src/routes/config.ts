import { Router, type IRouter } from "express";
import { GetAppConfigResponse } from "@workspace/api-zod";
import { promoQrUrl, storeUrl } from "../lib/config";

const router: IRouter = Router();

router.get("/config", (_req, res) => {
  const data = GetAppConfigResponse.parse({
    qrUrl: promoQrUrl(),
    storeUrl: storeUrl(),
  });
  res.json(data);
});

export default router;
