const BASE_URL = "https://api.tastytrade.com";
const ACCOUNT = process.env.TASTYTRADE_ACCOUNT_NUMBER ?? "5WI61720";

// ─── Session ──────────────────────────────────────────────────────────────

interface CachedSession { token: string; expiresAt: number }
let _session: CachedSession | null = null;

export function isTastytradeEnabled(): boolean {
  return !!(process.env.TASTYTRADE_USERNAME && process.env.TASTYTRADE_PASSWORD);
}

async function getToken(): Promise<string> {
  if (_session && Date.now() < _session.expiresAt - 5 * 60 * 1000) return _session.token;
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      login: process.env.TASTYTRADE_USERNAME,
      password: process.env.TASTYTRADE_PASSWORD,
      "remember-me": true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TT auth failed: ${res.status} ${body}`);
  }
  const json = await res.json();
  _session = { token: json.data["session-token"] as string, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
  return _session.token;
}

async function ttGet(path: string): Promise<any> {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: token } });
  if (!res.ok) throw new Error(`TT ${path} → ${res.status}`);
  return res.json();
}

const num = (v: any): number => {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  if (typeof v === "string") { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  return 0;
};

// ─── Options Chain ────────────────────────────────────────────────────────

export interface OptionContract {
  symbol: string;
  optionType: "call" | "put";
  strikePrice: number;
  expiration: string;
  daysToExpiration: number;
  bid: number;
  ask: number;
  mid: number;
  impliedVolatility: number; // percent, e.g. 28.45
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  openInterest: number;
  volume: number;
}

export interface OptionsChainExpiry {
  expiration: string;
  daysToExpiration: number;
  settlementType: string;
  contracts: OptionContract[];
}

export interface OptionsChain {
  underlying: string;
  expirations: OptionsChainExpiry[];
}

const chainCache = new Map<string, { data: OptionsChain; exp: number }>();
const CHAIN_TTL = 5 * 60 * 1000;

export async function getOptionsChain(symbol: string): Promise<OptionsChain> {
  const key = `chain:${symbol}`;
  const hit = chainCache.get(key);
  if (hit && Date.now() < hit.exp) return hit.data;

  const json = await ttGet(`/option-chains/${encodeURIComponent(symbol)}/nested`);
  const expirations: OptionsChainExpiry[] = [];

  for (const item of (json.data?.items ?? []) as any[]) {
    const expiration: string = item["expiration-date"];
    const dte = num(item["days-to-expiration"]);
    const settlementType: string = item["settlement-type"] ?? "";
    const contracts: OptionContract[] = [];

    for (const strike of (item.strikes ?? []) as any[]) {
      const strikePrice = num(strike["strike-price"]);
      for (const type of ["call", "put"] as const) {
        const c = strike[type];
        if (!c) continue;
        const bid = num(c.bid);
        const ask = num(c.ask);
        contracts.push({
          symbol: (c.symbol as string) ?? "",
          optionType: type,
          strikePrice,
          expiration,
          daysToExpiration: dte,
          bid,
          ask,
          mid: num(c["mid-price"] ?? (bid + ask) / 2),
          impliedVolatility: num(c["implied-volatility"]) * 100,
          delta: num(c.delta),
          gamma: num(c.gamma),
          theta: num(c.theta),
          vega: num(c.vega),
          openInterest: num(c["open-interest"]),
          volume: num(c.volume),
        });
      }
    }
    expirations.push({ expiration, daysToExpiration: dte, settlementType, contracts });
  }

  const chain: OptionsChain = { underlying: symbol, expirations };
  chainCache.set(key, { data: chain, exp: Date.now() + CHAIN_TTL });
  return chain;
}

// ─── Contract lookup (used by strategy engine) ────────────────────────────

export type ContractLookup = (
  type: "call" | "put",
  strike: number,
  expiry: string,
) => { mid: number; iv: number } | null;

export function makeContractLookup(chain: OptionsChain): ContractLookup {
  return (type, targetStrike, targetExpiry) => {
    // Find closest expiry by DTE
    const targetDte = Math.max(
      0,
      Math.ceil((new Date(targetExpiry).getTime() - Date.now()) / 86_400_000),
    );
    const expiry = chain.expirations.reduce((best, e) =>
      Math.abs(e.daysToExpiration - targetDte) < Math.abs(best.daysToExpiration - targetDte) ? e : best,
    chain.expirations[0]!);
    if (!expiry) return null;

    const candidates = expiry.contracts.filter(c => c.optionType === type && c.bid > 0);
    if (candidates.length === 0) return null;

    const best = candidates.reduce((b, c) =>
      Math.abs(c.strikePrice - targetStrike) < Math.abs(b.strikePrice - targetStrike) ? c : b,
    );
    return { mid: best.mid, iv: best.impliedVolatility };
  };
}

// ─── Positions ────────────────────────────────────────────────────────────

export interface TtRawPosition {
  symbol: string;
  instrumentType: string;
  underlying: string;
  quantity: number;
  direction: "Long" | "Short";
  openPrice: number;
  currentPrice: number;
  multiplier: number;
  costEffect: "Debit" | "Credit";
  expiresAt: string | null;
  createdAt: string;
}

export async function getRawPositions(): Promise<TtRawPosition[]> {
  const json = await ttGet(`/accounts/${ACCOUNT}/positions`);
  return ((json.data?.items ?? []) as any[]).map((item) => ({
    symbol: (item.symbol as string) ?? "",
    instrumentType: (item["instrument-type"] as string) ?? "",
    underlying: (item["underlying-symbol"] as string) ?? "",
    quantity: num(item.quantity),
    direction: (item["quantity-direction"] as "Long" | "Short") ?? "Long",
    openPrice: num(item["average-open-price"]),
    currentPrice: num(item["close-price"]),
    multiplier: num(item.multiplier) || 100,
    costEffect: (item["cost-effect"] as "Debit" | "Credit") ?? "Debit",
    expiresAt: (item["expires-at"] as string) ?? null,
    createdAt: (item["created-at"] as string) ?? "",
  }));
}

// ─── Balances ─────────────────────────────────────────────────────────────

export interface TtBalances {
  netLiquidatingValue: number;
  optionBuyingPower: number;
  cashBalance: number;
  realizedDayGain: number;
  unrealizedDayGain: number;
}

export async function getBalances(): Promise<TtBalances> {
  const json = await ttGet(`/accounts/${ACCOUNT}/balances`);
  const d = json.data ?? {};
  return {
    netLiquidatingValue: num(d["net-liquidating-value"]),
    optionBuyingPower: num(d["derivative-buying-power"] ?? d["option-buying-power"]),
    cashBalance: num(d["cash-balance"]),
    realizedDayGain: num(d["realized-day-gain"]),
    unrealizedDayGain: num(d["unrealized-day-gain"]),
  };
}
