/**
 * Schwab API Adapter
 * ──────────────────────────────────────────────────────────────────────────
 * Swap-in replacement for Yahoo Finance once you have Schwab credentials.
 *
 * Setup:
 *  1. Go to developer.schwab.com → My Apps → Create App
 *  2. Set Callback URL to: https://<your-replit-domain>/api/schwab/callback
 *  3. Copy your App Key (client ID) and Secret
 *  4. Add to Replit Secrets:
 *       SCHWAB_CLIENT_ID=<your-app-key>
 *       SCHWAB_CLIENT_SECRET=<your-secret>
 *       SCHWAB_REFRESH_TOKEN=<obtained-after-first-oauth-flow>
 *
 * OAuth Flow:
 *  1. GET /api/schwab/auth  →  redirects user to Schwab login
 *  2. Schwab redirects to your callback URL with ?code=...
 *  3. Exchange code for tokens, store refresh token in DB / secrets
 *  4. Use access token for all subsequent API calls (auto-refreshed here)
 *
 * Once wired up, replace imports of yahoo-finance in market-data.ts with
 * calls to the functions exported here.
 */

const SCHWAB_BASE = "https://api.schwabapi.com/marketdata/v1";
const TOKEN_URL   = "https://api.schwabapi.com/v1/oauth/token";

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 30_000) {
    return tokenCache.accessToken;
  }

  const clientId     = process.env.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  const refreshToken = process.env.SCHWAB_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Schwab credentials not configured. See artifacts/api-server/src/lib/schwab.ts for setup instructions.");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Schwab token refresh failed: ${resp.status} ${text}`);
  }

  const data = await resp.json() as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

async function schwabGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(`${SCHWAB_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const resp = await fetch(url.toString(), {
    headers: { "Authorization": `Bearer ${token}` },
  });

  if (!resp.ok) throw new Error(`Schwab API error: ${resp.status} ${path}`);
  return resp.json() as Promise<T>;
}

// ─── Quote ────────────────────────────────────────────────────────────────

export async function schwabGetQuote(symbol: string) {
  // Returns real-time quote from Schwab
  // GET /quotes/{symbol_id}
  // Returns: bid, ask, last, volume, 52w high/low, etc.
  const data = await schwabGet<any>(`/quotes/${symbol}`);
  // TODO: map Schwab response shape → MarketQuote interface
  return data;
}

// ─── Price History ─────────────────────────────────────────────────────────

export async function schwabGetHistory(symbol: string, period: string) {
  // GET /pricehistory
  // Params: symbol, periodType, period, frequencyType, frequency
  const params: Record<string, string> = {
    symbol,
    periodType: "month",
    period: "3",
    frequencyType: "daily",
    frequency: "1",
  };

  return schwabGet<any>("/pricehistory", params);
}

// ─── Options Chain ─────────────────────────────────────────────────────────

export async function schwabGetOptionsChain(symbol: string) {
  // GET /chains
  // Returns: full options chain with Greeks, bid/ask, OI, volume
  return schwabGet<any>("/chains", {
    symbol,
    contractType: "ALL",
    includeUnderlyingQuote: "true",
    strategy: "SINGLE",
  });
}

// ─── OAuth helpers (add routes to express app to complete setup) ───────────

export function schwabAuthUrl(): string {
  const clientId   = process.env.SCHWAB_CLIENT_ID ?? "";
  const redirectUri = process.env.SCHWAB_REDIRECT_URI ?? "https://localhost/api/schwab/callback";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "readonly",
  });
  return `https://api.schwabapi.com/v1/oauth/authorize?${params.toString()}`;
}

export async function schwabExchangeCode(code: string): Promise<{ access_token: string; refresh_token: string }> {
  const clientId     = process.env.SCHWAB_CLIENT_ID ?? "";
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET ?? "";
  const redirectUri  = process.env.SCHWAB_REDIRECT_URI ?? "";
  const credentials  = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Authorization": `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString(),
  });

  if (!resp.ok) throw new Error(`Schwab token exchange failed: ${resp.status}`);
  return resp.json() as Promise<{ access_token: string; refresh_token: string }>;
}
