import { Router, type IRouter } from "express";
import {
  exchangeAuthCode,
  getAuthorizationUrl,
  getTastytradeTokenExpiry,
  isTastytradeAuthorized,
  isTastytradeEnabled,
} from "../lib/tastytrade.js";
import { updateServerEnv } from "../lib/server-env.js";

const router: IRouter = Router();

// GET /auth/status
router.get("/status", (_req, res): void => {
  res.json({
    enabled:   isTastytradeEnabled(),
    connected: isTastytradeAuthorized(),
    expiresAt: getTastytradeTokenExpiry(),
  });
});

router.get("/tastytrade", (_req, res): void => {
  const redirectUri = process.env.TASTYTRADE_REDIRECT_URI ?? "";
  if (!process.env.TASTYTRADE_CLIENT_ID || !redirectUri) {
    res.status(400).json({ error: "TASTYTRADE_CLIENT_ID and TASTYTRADE_REDIRECT_URI must be configured" });
    return;
  }

  res.redirect(getAuthorizationUrl(redirectUri));
});

router.get("/tastytrade/callback", async (req, res): Promise<void> => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const redirectUri = process.env.TASTYTRADE_REDIRECT_URI ?? "";

  if (!code || !redirectUri) {
    res.status(400).send("Missing Tastytrade authorization code or redirect URI");
    return;
  }

  try {
    const result = await exchangeAuthCode(code, redirectUri);
    updateServerEnv({ TASTYTRADE_REFRESH_TOKEN: result.refreshToken });
    res.redirect("/settings");
  } catch (err) {
    res.status(500).send(`Tastytrade reconnect failed: ${(err as Error).message}`);
  }
});

export default router;
