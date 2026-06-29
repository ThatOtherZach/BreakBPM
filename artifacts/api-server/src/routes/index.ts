import { Router, type IRouter } from "express";
import healthRouter from "./health";
import configRouter from "./config";
import authRouter from "./auth";
import passesRouter from "./passes";
import cryptoRouter from "./crypto";
import subscriptionsRouter from "./subscriptions";
import gamesRouter from "./games";
import findPlayersRouter from "./findPlayers";
import venuesRouter from "./venues";
import sitemapRouter from "./sitemap";
import adsRouter from "./ads";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(configRouter);
router.use(authRouter);
router.use(passesRouter);
router.use(cryptoRouter);
router.use(subscriptionsRouter);
router.use(gamesRouter);
router.use(findPlayersRouter);
router.use(venuesRouter);
router.use(sitemapRouter);
router.use(adsRouter);
router.use(adminRouter);

export default router;
