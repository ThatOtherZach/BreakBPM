import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import passesRouter from "./passes";
import gamesRouter from "./games";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(passesRouter);
router.use(gamesRouter);

export default router;
