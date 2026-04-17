import { Router, type IRouter } from "express";
import { isTastytradeEnabled, setOAuthToken, getOAuthConfig } from "../lib/tastytrade.js";

const router: IRouter = Router();

const TOKEN_URL    = "https://api.tastytrade.com/oauth/token";
const AUTHORIZE_URL = "https://api.tastytrade.com/oauth/authorize";

// One-time in-memory state store (CSRF protection)
const pendingStates = new Set<string>();

function randomState(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// GET /auth/tastytrade — redirect browser to TT authorize page
router.get("/tastytrade", (_req, res): void => {
  if (!isTastytradeEnabled()) {
    res.status(503).send("Tastytrade OAuth credentials not configured (TASTYTRADE_CLIENT_ID / TASTYTRADE_CLIENT_SECRET missing).");
    return;
  }

  const { clientId, redirectUri } = getOAuthConfig();
  const state = randomState();
  pendingStates.add(state);
  // Clean up stale states after 10 min
  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000);

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id",     clientId);
  url.searchParams.set("redirect_uri",  redirectUri);
  url.searchParams.set("scope",         "read trade");
  url.searchParams.set("state",         state);

  res.redirect(url.toString());
});

// GET /auth/callback — exchange code for tokens
router.get("/callback", async (req, res): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    res.status(400).send(`Tastytrade authorization denied: ${error}`);
    return;
  }

  if (!state || !pendingStates.has(state)) {
    res.status(400).send("Invalid or expired OAuth state. Please try again: <a href='/auth/tastytrade'>Authorize Tastytrade</a>");
    return;
  }
  pendingStates.delete(state);

  if (!code) {
    res.status(400).send("Missing authorization code.");
    return;
  }

  const { redirectUri } = getOAuthConfig();
  const clientId     = process.env.TASTYTRADE_CLIENT_ID     ?? "";
  const clientSecret = process.env.TASTYTRADE_CLIENT_SECRET ?? "";

  try {
    const params = new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri:  redirectUri,
      client_id:     clientId,
      client_secret: clientSecret,
    });

    const tokenRes = await fetch(TOKEN_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    params.toString(),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => "");
      res.status(502).send(`Token exchange failed (${tokenRes.status}): ${body}`);
      return;
    }

    const json = await tokenRes.json();
    setOAuthToken(
      json.access_token  as string,
      json.refresh_token as string,
      json.expires_in    as number,
    );

    // Redirect to dashboard
    res.redirect("/");
  } catch (err: any) {
    res.status(500).send(`OAuth callback error: ${err.message}`);
  }
});

export default router;
