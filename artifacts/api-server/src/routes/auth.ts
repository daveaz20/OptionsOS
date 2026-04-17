import { Router, type IRouter } from "express";
import { isTastytradeEnabled, isTastytradeAuthorized, getTastytradeTokenExpiry } from "../lib/tastytrade.js";

const router: IRouter = Router();

// GET /auth/status
router.get("/status", (_req, res): void => {
  res.json({
    enabled:   isTastytradeEnabled(),
    connected: isTastytradeAuthorized(),
    expiresAt: getTastytradeTokenExpiry(),
  });
});

export default router;
