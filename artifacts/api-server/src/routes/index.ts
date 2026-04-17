import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stocksRouter from "./stocks";
import watchlistRouter from "./watchlist";
import strategiesRouter from "./strategies";
import dashboardRouter from "./dashboard";
import screenerRouter from "./screener";
import accountRouter from "./account";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stocksRouter);
router.use(watchlistRouter);
router.use(strategiesRouter);
router.use(dashboardRouter);
router.use(screenerRouter);
router.use(accountRouter);

export default router;
