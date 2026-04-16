# OptionsOS — Project Status

_Last updated: 2026-04-16_

---

## Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict) |
| Package manager | pnpm (workspaces monorepo) |
| Runtime | Node.js v24 |
| API server | Express 5, port 3000 |
| Frontend | React + Vite, port 3001 |
| Database | Postgres via Replit DB (Drizzle ORM) |
| Market data (primary) | Polygon.io Starter plan ($29/mo) — snapshots, bars, reference |
| Market data (fundamentals) | Yahoo Finance via `yahoo-finance2` npm package |
| Repo | GitHub — `daveaz20/OptionsOS` |
| Active branch | `dev` |

---

## Project structure

```
OptionsOS/
├── artifacts/
│   ├── api-server/src/
│   │   ├── lib/
│   │   │   ├── strategy-engine.ts   — Black-Scholes, Greeks, strategy P&L
│   │   │   ├── scanner.ts           — scanOpportunity(), scoring components
│   │   │   ├── technical-analysis.ts — RSI, MACD, ATR, SMA, S/R, signals
│   │   │   ├── market-data.ts       — Yahoo Finance quotes, HV, IV Rank
│   │   │   └── polygon.ts           — Snapshot, reference tickers, daily bars
│   │   └── routes/
│   │       ├── screener.ts          — /api/screener, /api/screener/stats
│   │       ├── strategy.ts          — /api/strategy
│   │       ├── dashboard.ts         — /api/dashboard
│   │       └── watchlist.ts         — /api/watchlist
│   └── options-platform/src/
│       └── components/workspace/
│           ├── StockListPanel.tsx   — screener list, conviction filter
│           ├── StrategyPanel.tsx    — P&L curves, Greeks display
│           └── ...
├── lib/
│   ├── db/src/schema/
│   │   ├── stocks.ts
│   │   ├── watchlist.ts
│   │   └── screener-cache.ts       — screener_cache Postgres table
│   └── api-client-react/           — generated API types + React Query hooks
└── scripts/
    ├── dev-start.sh                 — kills ports 3000/3001, starts both servers
    └── session-end.md               — end-of-session checklist
```

---

## Dev startup

```bash
bash scripts/dev-start.sh
```

This kills any process on ports 3000 and 3001 (`fuser -k`), starts the API server on port 3000, waits 3 seconds, then starts the frontend on port 3001.

Required environment variables:
- `POLYGON_API_KEY` — Polygon.io Starter plan key (enables full universe mode)
- `DATABASE_URL` — Postgres connection string (Replit DB)

Without `POLYGON_API_KEY` the screener falls back to Yahoo Finance (~477 curated symbols).

DB migration (first run or after schema changes):
```bash
pnpm --filter @workspace/db push
```

---

## Scoring system — current state

### opportunityScore (0–100)

Composite of five components, raw total clamped to 100:

| Component | Max | What it measures |
|---|---|---|
| `technicalScore` | 35 | Trend alignment, RSI zone, MACD, MA stack, strength |
| `ivScore` | 25 | IV rank vs strategy type (credit selling wants high IV, debit buying wants low) |
| `entryScore` | 25 | Price position within S/R range (near support = bullish ideal, near resistance = bearish ideal) |
| `momentumScore` | 15 | Volume ratio, trend strength, ATR% |
| `vwapScore` | 10 | Direction-gated: bullish above day+prevDay VWAP, bearish below, neutral 0 |
| **Total** | **110 → clamped 100** | |

### High conviction threshold

A stock counts as a high-conviction setup if it passes **all** of:
- `opportunityScore ≥ 75`
- `technicalScore ≥ 20`
- `ivScore ≥ 15`
- `entryScore ≥ 15`
- `momentumScore ≥ 8`

Implemented in `isHighConviction()` in `screener.ts`. Used by `/api/screener/stats` and displayed in `StockListPanel`.

### Setup types (from scanner.ts)

| Outlook + IV | Setup |
|---|---|
| Bullish + IV ≥60% | Bull Put Spread |
| Bullish + IV 40–60% + strength ≥6 | Covered Call |
| Bullish + IV <30% + strength ≥7 | Long Call |
| Bullish (default) | Call Spread |
| Bearish + IV ≥60% | Bear Call Spread |
| Bearish + IV <30% + strength ≤4 | Long Put |
| Bearish (default) | Bear Put Spread |
| Neutral + IV ≥65% or ≥45% | Iron Condor |
| Neutral + IV ≤25% | Straddle |
| Neutral (default) | Calendar |

### ScreenerRow fields (full type)

```ts
symbol, name, price, change, changePercent,
volume, avgVolume, relVol, marketCap, sector,
beta, pe, forwardPE, eps, dividendYield,
shortRatio, priceTarget, recommendation,
fiftyTwoWeekHigh, fiftyTwoWeekLow, pctFrom52High, pctFrom52Low,
earningsDate, technicalStrength, rsi14, macdHistogram, ivRank,
opportunityScore, technicalScore, ivScore, entryScore, momentumScore, vwapScore,
setupType, recommendedOutlook, supportPrice, resistancePrice,
liquidity: "Liquid" | "Illiquid",
source: "polygon" | "yahoo"
```

---

## Data pipeline — Polygon mode

1. **Startup**: load DB cache (if ≤4h old), then trigger background refresh
2. **Snapshot fetch**: `GET /v2/snapshot/locale/us/markets/stocks/tickers` — all US stocks
3. **Reference fetch**: `GET /v3/reference/tickers` — names, types, exchanges
4. **Filter**: CS + ADRC, price ≥$2, volume ≥100k → ~3000–5000 quality stocks
5. **Yahoo quotes**: `getQuotes()` for DEFAULT_UNIVERSE (~477 symbols) — P/E, beta, earnings
6. **Main loop** (15 concurrent, 500ms between batches):
   - `getPolygonBars(ticker, 580)` — 580 calendar days of daily OHLCV
   - `getHistoricalVolatility(ticker)` — Yahoo Finance 1-year HV, IV Rank proxy
   - `computeSignals(bars, price)` — RSI, MACD, SMA20/50/200, ATR, S/R, trend
   - `scanOpportunity(signals, ivRank, price, chPct, dte, dayVwap, prevDayVwap)` — full score
7. **Persist**: write rows to `screener_cache` Postgres table (fire-and-forget)

Cache TTL: 30 min in-memory, 4 hours DB stale threshold.

---

## Known issues / pending

- **`Stock` type in `api-client-react/src/generated/api.schemas.ts`** does not include `technicalScore`, `ivScore`, `entryScore`, `momentumScore`, `vwapScore`. These fields are returned by the API but the generated client type doesn't know about them. This means the frontend can't use sub-scores for filtering without updating the generated types or casting.

- **IV Rank is a proxy (HV-based), not true options IV Rank**. True IV Rank requires options chain data which costs $199/mo on Polygon. The proxy (where is current 30-day HV relative to its 1-year range) is directionally correct but not equivalent to what options traders mean by IV Rank.

- **`getHistoricalVolatility` still calls Yahoo Finance for every stock** in the full universe. With ~3000–5000 stocks, Yahoo rate-limiting is likely. The fallback returns `{ ivRank: 50 }` so scoring proceeds, but many stocks will have neutral IV scores rather than real ones. Long-term fix: compute HV directly from Polygon bars (which we already have).

- **Polygon Starter plan rate limit** is 100 requests/minute. At 15 concurrent with 500ms delay, sustained throughput is ~1800 req/min during the bars fetch loop — well above limit. The 500ms delay gives 30 req/500ms = 60 req/s. Monitor for 429 responses and increase delay if needed.

- **`Stock` API type is hand-maintained** in `api-client-react/src/generated/api.schemas.ts`. It was generated once and diverged from the actual `ScreenerRow` type. Should be regenerated from an OpenAPI spec.

---

## Branches

| Branch | Status |
|---|---|
| `dev` | Active development — all session work lands here |
| `main` | Not used for active dev — treat as stable baseline |

All work from this session is on `dev`. Last commit: `4452172` (docs: add session-end checklist).
