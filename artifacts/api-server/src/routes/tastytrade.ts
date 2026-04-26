import { Router, type IRouter, type Response } from "express";
import {
  getMarginRequirement,
  getNetLiqHistory,
  getAccountBalances,
  getOptionsChain,
  getQuoteSnapshots,
  getStreamerStatus,
  getStreamedGreeks,
  getStreamedQuote,
  getTransactions,
  isStreamerConnected,
  isTastytradeAuthorized,
  isTastytradeEnabled,
  subscribeGreeks,
  subscribeQuotes,
  type MarginRequirementRequest,
} from "../lib/tastytrade.js";

const router: IRouter = Router();

function parseSymbols(input: unknown): string[] {
  if (typeof input !== "string") return [];
  return [...new Set(input.split(",").map((value) => value.trim()).filter(Boolean))];
}

function parseUnderlyingFromOptionSymbol(symbol: string): string | null {
  const normalized = symbol.trim().replace(/^\./, "");
  const match = normalized.match(/^([A-Z.]+?)(\d{6}[CP].*)$/);
  return match ? match[1] ?? null : null;
}

function ensureTastytradeReady(res: Response): boolean {
  if (!isTastytradeEnabled()) {
    res.status(503).json({ error: "Tastytrade OAuth credentials not configured" });
    return false;
  }
  if (!isTastytradeAuthorized()) {
    res.status(503).json({ error: "Tastytrade not authorized", authUrl: "/api/auth/tastytrade" });
    return false;
  }
  return true;
}

router.get("/tastytrade/quotes", async (req, res): Promise<void> => {
  if (!ensureTastytradeReady(res)) return;

  const symbols = parseSymbols(req.query.symbols);
  if (symbols.length === 0) {
    res.json([]);
    return;
  }

  subscribeQuotes(symbols);

  const streamedQuotes = new Map<string, {
    symbol: string;
    bid: number;
    ask: number;
    last: number;
    mark: number;
    volume: number;
    source: "stream";
  }>();

  if (isStreamerConnected()) {
    for (const symbol of symbols) {
      const streamed = getStreamedQuote(symbol);
      if (!streamed) continue;
      streamedQuotes.set(symbol.toUpperCase(), {
        symbol,
        bid: streamed.bid,
        ask: streamed.ask,
        last: streamed.last,
        mark: streamed.mark,
        volume: streamed.volume,
        source: "stream",
      });
    }
  }

  try {
    const missing = symbols.filter((symbol) => !streamedQuotes.has(symbol.toUpperCase()));
    const snapshots = missing.length > 0 ? await getQuoteSnapshots(missing) : new Map();
    res.json(symbols.map((symbol) => {
      const streamed = streamedQuotes.get(symbol.toUpperCase());
      if (streamed) return streamed;
      const quote = snapshots.get(symbol.toUpperCase());
      return {
        symbol,
        bid: quote?.bid ?? 0,
        ask: quote?.ask ?? 0,
        last: quote?.last ?? 0,
        mark: quote?.mark ?? 0,
        volume: quote?.volume ?? 0,
        source: quote ? "rest" : "none",
      };
    }));
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch Tastytrade quotes: ${(err as Error).message}` });
  }
});

router.get("/tastytrade/greeks", async (req, res): Promise<void> => {
  if (!ensureTastytradeReady(res)) return;

  const symbols = parseSymbols(req.query.symbols);
  if (symbols.length === 0) {
    res.json([]);
    return;
  }

  subscribeGreeks(symbols);

  if (isStreamerConnected()) {
    res.json(symbols.map((symbol) => {
      const greeks = getStreamedGreeks(symbol);
      return {
        symbol,
        delta: greeks?.delta ?? 0,
        gamma: greeks?.gamma ?? 0,
        theta: greeks?.theta ?? 0,
        vega: greeks?.vega ?? 0,
        rho: greeks?.rho ?? 0,
        iv: greeks?.iv ?? 0,
        source: greeks ? "stream" : "none",
      };
    }));
    return;
  }

  try {
    const byUnderlying = new Map<string, string[]>();
    for (const symbol of symbols) {
      const underlying = parseUnderlyingFromOptionSymbol(symbol);
      if (!underlying) continue;
      if (!byUnderlying.has(underlying)) byUnderlying.set(underlying, []);
      byUnderlying.get(underlying)!.push(symbol);
    }

    const results = new Map<string, {
      symbol: string;
      delta: number;
      gamma: number;
      theta: number;
      vega: number;
      rho: number;
      iv: number;
      source: string;
    }>();

    for (const [underlying, optionSymbols] of byUnderlying.entries()) {
      const chain = await getOptionsChain(underlying);
      for (const optionSymbol of optionSymbols) {
        const contract = chain.expirations
          .flatMap((expiry) => expiry.contracts)
          .find((entry) => entry.streamerSymbol === optionSymbol || entry.symbol === optionSymbol);

        if (contract) {
          results.set(optionSymbol, {
            symbol: optionSymbol,
            delta: contract.delta,
            gamma: contract.gamma,
            theta: contract.theta,
            vega: contract.vega,
            rho: contract.rho ?? 0,
            iv: contract.impliedVolatility,
            source: contract.greeksSource,
          });
        }
      }
    }

    res.json(symbols.map((symbol) => results.get(symbol) ?? {
      symbol,
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
      iv: 0,
      source: "none",
    }));
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch Tastytrade greeks: ${(err as Error).message}` });
  }
});

async function handleMarginRequest(body: unknown, res: Response): Promise<void> {
  if (!ensureTastytradeReady(res)) return;

  const payload = body as Partial<MarginRequirementRequest> | undefined;
  if (!payload?.symbol || !Array.isArray(payload.legs)) {
    res.status(400).json({ error: "Expected body { symbol, legs: [{ instrument_type, symbol, quantity, action }] }" });
    return;
  }

  try {
    const margin = await getMarginRequirement({
      symbol: payload.symbol,
      legs: payload.legs,
    });
    res.json(margin);
  } catch (err) {
    res.status(500).json({ error: `Failed to calculate margin requirement: ${(err as Error).message}` });
  }
}

router.post("/tastytrade/margin", async (req, res): Promise<void> => {
  await handleMarginRequest(req.body, res);
});

router.get("/tastytrade/margin", async (req, res): Promise<void> => {
  const raw = typeof req.query.legs === "string" ? req.query.legs : "";
  try {
    const parsed = raw ? JSON.parse(raw) : req.body;
    await handleMarginRequest(parsed, res);
  } catch {
    res.status(400).json({ error: "Invalid legs payload" });
  }
});

router.get("/tastytrade/transactions", async (req, res): Promise<void> => {
  if (!ensureTastytradeReady(res)) return;

  const limit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 100;
  try {
    const transactions = await getTransactions(Number.isFinite(limit) ? limit : 100);
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch transactions: ${(err as Error).message}` });
  }
});

router.get("/tastytrade/netliq-history", async (_req, res): Promise<void> => {
  if (!ensureTastytradeReady(res)) return;

  try {
    const history = await getNetLiqHistory("1y");
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch net liq history: ${(err as Error).message}` });
  }
});

router.get("/tastytrade/streamer-status", (_req, res): void => {
  if (!isTastytradeEnabled()) {
    res.json({ connected: false, subscribedSymbols: 0, subscribedOptions: 0 });
    return;
  }

  res.json(getStreamerStatus());
});

router.post("/tastytrade/test", async (_req, res): Promise<void> => {
  if (!ensureTastytradeReady(res)) return;

  try {
    await getAccountBalances();
    res.json({ ok: true, message: "Tastytrade connection verified" });
  } catch (err) {
    res.status(500).json({ ok: false, error: `Tastytrade test failed: ${(err as Error).message}` });
  }
});

export default router;
