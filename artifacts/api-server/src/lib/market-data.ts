/**
 * Market Data Service
 * Primary: Yahoo Finance (live, no API key)
 * Future: Schwab API (swap in schwab.ts when credentials are ready)
 */

import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// In-memory cache to avoid hammering Yahoo Finance
interface CacheEntry<T> { data: T; expiresAt: number }
const cache = new Map<string, CacheEntry<unknown>>();

function getCache<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

const QUOTE_TTL = 5 * 60 * 1000;      // 5 min
const HISTORY_TTL = 30 * 60 * 1000;   // 30 min
const OPTIONS_TTL = 15 * 60 * 1000;   // 15 min

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Static sector map (batch API doesn't return sector field) ────────────────

const SECTOR_MAP: Record<string, string> = {
  // Technology
  ...Object.fromEntries(["AAPL","MSFT","NVDA","AVGO","ORCL","CRM","ADBE","NOW","INTU","SNOW","PLTR","WDAY","TEAM","DDOG","MDB","ZS","CRWD","NET","OKTA","FTNT","PANW","HUBS","TTD","GDDY","DOCN","CFLT","GTLB","U","RBLX","APP","AI","BBAI","SOUN","ASAN","ZI","AMD","INTC","QCOM","MU","ARM","AMAT","LRCX","KLAC","MCHP","TXN","MRVL","SMCI","ADI","SWKS","MPWR","NXPI","ON","WOLF","ENPH","FSLR","ANET","KEYS","NTAP","SNPS","CDNS","ANSS","EPAM","CTSH","ACN","IBM","HPQ","HPE","CSCO","TEL","GLW","JNPR","FFIV","AKAM","CDW","LDOS"].map(s=>[s,"Technology"])),
  // Communication Services
  ...Object.fromEntries(["GOOGL","GOOG","META","DIS","NFLX","CMCSA","T","VZ","TMUS","CHTR","DISH","SIRI","PARA","WBD","FOX","FOXA","IPG","OMC"].map(s=>[s,"Communication Services"])),
  // Financial Services
  ...Object.fromEntries(["JPM","BAC","WFC","GS","MS","C","AXP","V","MA","BLK","SCHW","BK","COF","USB","PNC","TFC","SPGI","MCO","ICE","CME","CBOE","MSCI","FIS","FISV","DFS","SYF","ALLY","MTB","CFG","RF","FITB","HBAN","KEY","PRU","MET","AFL","ALL","MMC","AJG","PGR","HIG","CB","TRV","CINF","PYPL","COIN","SQ","HOOD","SOFI","NDAQ","MKTX","RJF","SEIC","LPLA"].map(s=>[s,"Financial Services"])),
  // Healthcare
  ...Object.fromEntries(["UNH","JNJ","LLY","ABBV","MRK","TMO","ABT","DHR","ISRG","BSX","MDT","SYK","BMY","GILD","VRTX","AMGN","REGN","PFE","MRNA","BIIB","CI","CVS","HCA","ELV","MCK","IQV","BDX","ZTS","IDXX","DGX","PODD","INCY","ALNY","ILMN","EXAS","HOLX","GEHC","BAX","EW","HUM","MOH","CNC","WBA","RMD","DXCM","ALGN","STE","BIO","PKI"].map(s=>[s,"Healthcare"])),
  // Consumer Cyclical
  ...Object.fromEntries(["AMZN","TSLA","HD","MCD","NKE","SBUX","TGT","LOW","BKNG","ABNB","CMG","DHI","LEN","PHM","MAR","HLT","RCL","CCL","NCLH","LYV","EA","TTWO","F","GM","ROST","TJX","ULTA","LULU","RL","TPR","CPRI","VFC","GAP","BBWI","BBY","AZO","ORLY","GPC","KMX","AN","CHWY","W","ETSY","EBAY","EXPE","VRSK","YELP","TRIP"].map(s=>[s,"Consumer Cyclical"])),
  // Consumer Defensive
  ...Object.fromEntries(["WMT","COST","PG","KO","PEP","PM","MO","MDLZ","CL","GIS","K","KMB","CLX","EL","HRL","CAG","MKC","SJM","CHD","HSY","MNST","KDP","KHC","STZ","TAP","BG","ADM","MOS","INGR","SFM"].map(s=>[s,"Consumer Defensive"])),
  // Energy
  ...Object.fromEntries(["XOM","CVX","COP","SLB","EOG","MPC","PSX","VLO","HAL","OXY","DVN","HES","APA","MRO","CTRA","EQT","RRC","AR","FANG","BKR","NOV","CHK","WMB","OKE","KMI","LNG","ET","EPD","MPLX","PAA"].map(s=>[s,"Energy"])),
  // Industrials
  ...Object.fromEntries(["GE","RTX","HON","UPS","BA","CAT","DE","MMM","ITW","EMR","LMT","NOC","GD","TDG","LHX","PH","ETN","ROK","AME","GWW","FAST","IR","FTV","ROP","CTAS","SWK","XYL","TRMB","PCAR","ODFL","CHRW","EXPD","JBHT","NSC","CSX","UNP","CP","WAB","TT","CARR","OTIS","MAS","SNA","PNR","GNRC","AOS","LII","FDX","DAL","UAL","AAL","LUV","ALK","HA","SAVE","JBLU","UBER","LYFT","DKNG","PENN"].map(s=>[s,"Industrials"])),
  // Basic Materials
  ...Object.fromEntries(["NEM","FCX","DOW","LYB","APD","ECL","CF","NTR","ALB","CE","FMC","IFF","EMN","OLIN","ASH","HUN","AMCR","PKG","IP","SEE","WRK","SON"].map(s=>[s,"Basic Materials"])),
  // Real Estate
  ...Object.fromEntries(["AMT","PLD","CCI","EQIX","PSA","SPG","O","WELL","DLR","AVB","EQR","ESS","MAA","UDR","CPT","VTR","PEAK","SBA","SBAC","HST","EXR","INVH","STAG","ARE","BXP","KIM","REG"].map(s=>[s,"Real Estate"])),
  // Utilities
  ...Object.fromEntries(["NEE","DUK","SO","D","EXC","SRE","AEP","PCG","ED","WEC","ES","PPL","AEE","ETR","EVRG","CNP","NI","LNT","PNW"].map(s=>[s,"Utilities"])),
};

export function getSectorForSymbol(symbol: string): string {
  return SECTOR_MAP[symbol] ?? "";
}

// ─── Quote ────────────────────────────────────────────────────────────────────

export interface MarketQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  marketCap: number;
  sector: string;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  eps: number;
  pe: number;
  forwardPE: number;
  dividendYield: number;
  earningsDate: string;
  beta: number;
  relVol: number;         // volume / avgVolume
  shortRatio: number;     // days to cover short interest
  priceTarget: number;    // analyst mean target price
  recommendation: number; // 1=Strong Buy … 5=Strong Sell (raw analyst mean)
}

export async function getQuote(symbol: string): Promise<MarketQuote> {
  const key = `quote:${symbol}`;
  const cached = getCache<MarketQuote>(key);
  if (cached) return cached;

  const q = await yahooFinance.quote(symbol, {}, { validateResult: false });

  const avgVol = q.averageDailyVolume3Month ?? q.regularMarketVolume ?? 1;
  const vol    = q.regularMarketVolume ?? 0;
  const data: MarketQuote = {
    symbol: q.symbol ?? symbol,
    name: q.longName ?? q.shortName ?? symbol,
    price: q.regularMarketPrice ?? 0,
    change: q.regularMarketChange ?? 0,
    changePercent: q.regularMarketChangePercent ?? 0,
    volume: vol,
    avgVolume: avgVol,
    marketCap: q.marketCap ?? 0,
    sector: (q as any).sector ?? "Equity",
    fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? 0,
    fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? 0,
    eps: q.epsTrailingTwelveMonths ?? 0,
    pe: q.trailingPE ?? 0,
    forwardPE: (q as any).forwardPE ?? 0,
    dividendYield: q.trailingAnnualDividendYield ?? 0,
    earningsDate: q.earningsTimestamp
      ? new Date(q.earningsTimestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "TBD",
    beta: (q as any).beta ?? 1,
    relVol: avgVol > 0 ? round2(vol / avgVol) : 1,
    shortRatio: (q as any).shortRatio ?? 0,
    priceTarget: (q as any).targetMeanPrice ?? 0,
    recommendation: (q as any).recommendationMean ?? 3,
  };

  // Enrich with summary detail for sector if not available
  if (data.sector === "Equity") {
    try {
      const summary = await yahooFinance.quoteSummary(symbol, { modules: ["assetProfile"] }, { validateResult: false });
      data.sector = summary.assetProfile?.sector ?? "Equity";
    } catch {}
  }

  setCache(key, data, QUOTE_TTL);
  return data;
}

export async function getQuotes(symbols: string[]): Promise<MarketQuote[]> {
  // Use yahoo-finance2 batch quoting — one network round-trip for all symbols
  const cacheKey = `quotes:batch:${symbols.sort().join(",")}`;
  const cached = getCache<MarketQuote[]>(cacheKey);
  if (cached) return cached;

  // Fetch individual cached quotes first, only hit network for misses
  const missing: string[] = [];
  const fromCache: MarketQuote[] = [];
  for (const s of symbols) {
    const c = getCache<MarketQuote>(`quote:${s}`);
    if (c) fromCache.push(c);
    else missing.push(s);
  }
  if (missing.length === 0) return fromCache;

  try {
    // yahoo-finance2 accepts an array — returns QuoteResult[]
    const raw = await (yahooFinance.quote as any)(missing, {}, { validateResult: false });
    const results: any[] = Array.isArray(raw) ? raw : [raw];
    const fetched: MarketQuote[] = results.map((q: any) => {
      const avgVol2 = q.averageDailyVolume3Month ?? q.regularMarketVolume ?? 1;
      const vol2    = q.regularMarketVolume ?? 0;
      return {
        symbol:          q.symbol ?? "",
        name:            q.longName ?? q.shortName ?? q.symbol ?? "",
        price:           q.regularMarketPrice ?? 0,
        change:          q.regularMarketChange ?? 0,
        changePercent:   q.regularMarketChangePercent ?? 0,
        volume:          vol2,
        avgVolume:       avgVol2,
        marketCap:       q.marketCap ?? 0,
        sector:          q.sector && q.sector !== "Equity" ? q.sector : (SECTOR_MAP[q.symbol ?? ""] ?? "Equity"),
        fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? 0,
        fiftyTwoWeekLow:  q.fiftyTwoWeekLow ?? 0,
        eps:              q.epsTrailingTwelveMonths ?? 0,
        pe:               q.trailingPE ?? 0,
        forwardPE:        q.forwardPE ?? 0,
        dividendYield:    q.trailingAnnualDividendYield ?? 0,
        earningsDate:     q.earningsTimestamp
          ? new Date(q.earningsTimestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : "TBD",
        beta:             q.beta ?? 1,
        relVol:           avgVol2 > 0 ? round2(vol2 / avgVol2) : 1,
        shortRatio:       q.shortRatio ?? 0,
        priceTarget:      q.targetMeanPrice ?? 0,
        recommendation:   q.recommendationMean ?? 3,
      };
    }).filter((q) => q.symbol && q.price > 0);

    // Warm individual caches
    for (const q of fetched) setCache(`quote:${q.symbol}`, q, QUOTE_TTL);

    return [...fromCache, ...fetched];
  } catch {
    // Fallback: serial fetch with individual caches
    const fallback = await Promise.all(missing.map((s) => getQuote(s).catch(() => null as any)));
    return [...fromCache, ...fallback.filter(Boolean)];
  }
}

// ─── Price History ─────────────────────────────────────────────────────────

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function getPriceHistory(symbol: string, period: string): Promise<OHLCV[]> {
  const key = `history:${symbol}:${period}`;
  const cached = getCache<OHLCV[]>(key);
  if (cached) return cached;

  const { interval, period1 } = periodToYahoo(period);

  const result = await yahooFinance.chart(symbol, {
    interval,
    period1,
  }, { validateResult: false });

  const quotes = result.quotes ?? [];
  const data: OHLCV[] = quotes
    .filter((q) => q.open && q.high && q.low && q.close)
    .map((q) => ({
      date: new Date(q.date).toISOString().split("T")[0],
      open: round2(q.open!),
      high: round2(q.high!),
      low: round2(q.low!),
      close: round2(q.close!),
      volume: Math.round(q.volume ?? 0),
    }));

  setCache(key, data, HISTORY_TTL);
  return data;
}

function periodToYahoo(period: string): { interval: "1d" | "1wk" | "1mo"; period1: Date } {
  const ago = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return d; };
  switch (period) {
    case "1D":   return { interval: "1d",  period1: ago(5) };
    case "1W":   return { interval: "1d",  period1: ago(30) };
    case "1M":   return { interval: "1d",  period1: ago(90) };
    case "3M":   return { interval: "1d",  period1: ago(180) };
    case "6M":   return { interval: "1d",  period1: ago(365) };
    case "1Y":   return { interval: "1wk", period1: ago(730) };
    // TECH: ~410 daily bars — enough for SMA200 + proper MACD/RSI warm-up
    case "TECH": return { interval: "1d",  period1: ago(580) };
    default:     return { interval: "1d",  period1: ago(180) };
  }
}

// ─── Historical Volatility (for IV Rank proxy) ────────────────────────────

export async function getHistoricalVolatility(symbol: string): Promise<{ hv30: number; hv252: number; ivRank: number }> {
  const key = `hv:${symbol}`;
  const cached = getCache<{ hv30: number; hv252: number; ivRank: number }>(key);
  if (cached) return cached;

  const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const result = await yahooFinance.chart(symbol, { interval: "1d", period1: oneYearAgo }, { validateResult: false });
  const closes = (result.quotes ?? []).filter((q) => q.close).map((q) => q.close!);

  const hv = (window: number) => {
    if (closes.length < window + 1) return 0.25;
    const slice = closes.slice(-window - 1);
    const returns = slice.slice(1).map((c, i) => Math.log(c / slice[i]));
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance * 252);
  };

  const hv30 = hv(30);
  const hv252 = hv(252);

  // IV Rank proxy: where is HV30 relative to its 1-year range
  const windows: number[] = [];
  for (let i = 31; i <= closes.length; i++) {
    const slice = closes.slice(i - 31, i);   // 31 closes → 30 log-returns, matching hv(30)
    const returns = slice.slice(1).map((c, idx) => Math.log(c / slice[idx]));
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    windows.push(Math.sqrt(variance * 252));
  }

  const minHv = Math.min(...windows);
  const maxHv = Math.max(...windows);
  const ivRank = maxHv === minHv ? 50 : Math.round(((hv30 - minHv) / (maxHv - minHv)) * 100);

  const out = { hv30: round2(hv30 * 100), hv252: round2(hv252 * 100), ivRank: Math.max(0, Math.min(100, ivRank)) };
  setCache(key, out, OPTIONS_TTL);
  return out;
}

// Default scanner universe — 100 liquid, optionable stocks
export const DEFAULT_UNIVERSE = [
  // ── Mega-Cap Tech ──────────────────────────────────────────────────────────
  "AAPL","MSFT","NVDA","GOOGL","GOOG","AMZN","META","TSLA","AVGO","ORCL",
  // ── Software / Cloud ───────────────────────────────────────────────────────
  "CRM","ADBE","NOW","INTU","SNOW","PLTR","WDAY","TEAM","DDOG","MDB",
  "ZS","CRWD","NET","OKTA","FTNT","PANW","HUBS","TTD","GDDY","DOCN",
  "CFLT","GTLB","U","RBLX","APP","AI","BBAI","SOUN","ASAN","ZI",
  // ── Semiconductors ─────────────────────────────────────────────────────────
  "AMD","INTC","QCOM","MU","ARM","AMAT","LRCX","KLAC","MCHP","TXN",
  "MRVL","SMCI","ADI","SWKS","MPWR","NXPI","ON","WOLF","ENPH","FSLR",
  "ANET","KEYS","NTAP","SNPS","CDNS","ANSS","EPAM","CTSH","ACN","IBM",
  "HPQ","HPE","CSCO","TEL","GLW","JNPR","FFIV","AKAM","CDW","LDOS",
  // ── Financials ─────────────────────────────────────────────────────────────
  "JPM","BAC","WFC","GS","MS","C","AXP","V","MA","BLK","SCHW","BK",
  "COF","USB","PNC","TFC","SPGI","MCO","ICE","CME","CBOE","MSCI",
  "FIS","FISV","DFS","SYF","ALLY","MTB","CFG","RF","FITB","HBAN","KEY",
  "PRU","MET","AFL","ALL","MMC","AJG","PGR","HIG","CB","TRV","CINF",
  "PYPL","COIN","SQ","HOOD","SOFI","NDAQ","MKTX","RJF","SEIC","LPLA",
  // ── Healthcare / Biotech ───────────────────────────────────────────────────
  "UNH","JNJ","LLY","ABBV","MRK","TMO","ABT","DHR","ISRG","BSX",
  "MDT","SYK","BMY","GILD","VRTX","AMGN","REGN","PFE","MRNA","BIIB",
  "CI","CVS","HCA","ELV","MCK","IQV","BDX","ZTS","IDXX","DGX",
  "PODD","INCY","ALNY","ILMN","EXAS","HOLX","VRTX","GEHC","BAX","EW",
  "HUM","MOH","CNC","WBA","RMD","DXCM","ALGN","STE","BIO","PKI",
  // ── Consumer Discretionary ─────────────────────────────────────────────────
  "AMZN","TSLA","HD","MCD","NKE","SBUX","TGT","LOW","BKNG","ABNB",
  "CMG","DHI","LEN","PHM","MAR","HLT","RCL","CCL","NCLH","LYV",
  "EA","TTWO","F","GM","ROST","TJX","ULTA","LULU","RL","TPR",
  "CPRI","VFC","GAP","BBWI","BBY","AZO","ORLY","GPC","KMX","AN",
  "DIS","NFLX","CHWY","W","ETSY","EBAY","EXPE","VRSK","YELP","TRIP",
  // ── Consumer Staples ───────────────────────────────────────────────────────
  "WMT","COST","PG","KO","PEP","PM","MO","MDLZ","CL","GIS",
  "K","KMB","CLX","EL","HRL","CAG","MKC","SJM","CHD","HSY",
  "MNST","KDP","KHC","STZ","TAP","BG","ADM","MOS","INGR","SFM",
  // ── Energy ─────────────────────────────────────────────────────────────────
  "XOM","CVX","COP","SLB","EOG","MPC","PSX","VLO","HAL","OXY",
  "DVN","HES","APA","MRO","CTRA","EQT","RRC","AR","FANG","BKR",
  "NOV","CHK","WMB","OKE","KMI","LNG","ET","EPD","MPLX","PAA",
  // ── Industrials / Defense ──────────────────────────────────────────────────
  "GE","RTX","HON","UPS","BA","CAT","DE","MMM","ITW","EMR",
  "LMT","NOC","GD","TDG","LHX","PH","ETN","ROK","AME","GWW",
  "FAST","IR","FTV","ROP","CTAS","SWK","XYL","TRMB","PCAR","ODFL",
  "CHRW","EXPD","JBHT","NSC","CSX","UNP","CP","WAB","TT","CARR",
  "OTIS","MAS","SNA","PNR","GNRC","AOS","LII","FDX","DAL","UAL",
  "AAL","LUV","ALK","HA","SAVE","JBLU","UBER","LYFT","DKNG","PENN",
  // ── Materials ──────────────────────────────────────────────────────────────
  "LIN","APD","ECL","DD","NEM","FCX","CTVA","CF","ALB","PKG",
  "IP","PPG","SHW","RPM","EMN","HUN","CE","WRK","SON","SEE",
  "BALL","ATR","ARW","AVY","GEF","FMC","IFF","NUE","STLD","RS",
  // ── Real Estate ────────────────────────────────────────────────────────────
  "AMT","PLD","CCI","EQIX","SBAC","DLR","PSA","EXR","VICI","SPG",
  "AVB","EQR","ESS","MAA","UDR","CPT","INVH","AMH","WY","WPC",
  "NNN","VNO","BXP","WELL","MPW","OHI","NHI","LTC","HR","CBRE",
  // ── Utilities ──────────────────────────────────────────────────────────────
  "NEE","DUK","SO","D","EXC","XEL","AEE","ES","FE","ETR",
  "PPL","WEC","AWK","CMS","PNW","AES","EIX","PCG","PEG","DTE",
  "CNP","NRG","VST","BEP","EVA","BEPC","AQN","CWEN","OGE","EVRG",
  // ── Communication Services ─────────────────────────────────────────────────
  "CMCSA","T","VZ","TMUS","WBD","PARA","FOXA","DISH","OMC","IPG",
  "MTCH","SNAP","PINS","RDDT","SPOT","BIDU","NTES","MSTR","LUMN","IDT",
  // ── ETFs / Volatility Products ─────────────────────────────────────────────
  "SPY","QQQ","IWM","DIA","GLD","SLV","TLT","HYG","VXX","UVXY",
  "XLE","XLF","XLK","XLV","XLI","XLP","XLY","XLC","XLRE","XLU","XLB",
  "SMH","SOXX","IBB","XBI","GDX","GDXJ","USO","UNG","FXI","EEM","EFA",
  "ARKK","TNA","TQQQ","SQQQ","SPXU","UVIX","SVXY",
];
