import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stocksRouter from "./stocks";
import watchlistRouter from "./watchlist";
import strategiesRouter from "./strategies";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stocksRouter);
router.use(watchlistRouter);
router.use(strategiesRouter);
router.use(dashboardRouter);

export default router;
