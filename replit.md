# OptionsPlay — Options Trading Analytics Platform

## Overview

A modern, Apple-inspired options trading analytics platform with live market data, institutional-grade technical analysis, and OptionsPlay-style strategy scoring across 3,489+ quality US stocks.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS (Apple dark theme, Inter font)
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild
- **Market data**: Polygon.io (primary, 3,489 stocks) + yahoo-finance2 (fundamentals fallback)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Architecture

### Frontend (artifacts/options-platform)
- **Dashboard** (`/`): Market breadth stats, top opportunities, top movers, sector performance, volatility leaders, watchlist. Customizable layout (drag/drop modules, persisted to localStorage `dashboard_v2`).
- **Screener** (`/screener`): Full 3,489-stock table with 6 view tabs (Overview, Performance, Technicals, Fundamentals, Options, Factor Alpha), preset filters, custom filters, sort-by-column. Polygon badge.
- **Analysis** (`/scanner`): Individual stock deep-dive workspace.
- **Routing**: `wouter` (NOT react-router-dom)
- **API calls**: Relative `/api/...` paths proxied via Replit to port 8080

### Backend (artifacts/api-server)

#### Data Sources
- **Polygon.io** (`lib/polygon.ts`): Primary universe. Snapshot endpoint pulls 11k+ tickers → filtered to 3,489 quality CS/ADRC stocks (price ≥ $2, volume ≥ 100k). `POLYGON_API_KEY` secret required.
- **Yahoo Finance** (`lib/market-data.ts`): Fundamentals fallback (P/E, beta, dividends, earnings dates) for the curated 477-symbol universe. 5-min/30-min in-memory TTL cache.

#### Technical Analysis (`lib/technical-analysis.ts`)
- **RSI-14**: Wilder's SMMA (seed with simple avg of first 14 bars, then iterate)
- **MACD**: Proper EMA(12,26,9) — full EMA series aligned, then EMA(9) of MACD line for real signal
- **Lookback**: **"TECH" period = 580 calendar days of daily bars** (~410 trading days) — enough for SMA200 warmup + stable MACD/RSI
- SMA 20/50/200, ATR-14, volume ratio, swing-pivot S/R (5-bar pivot over last 60 bars), composite strength score (0–10)

#### Opportunity Scanner (`lib/scanner.ts`)
- 4-factor scoring (0–100): Technical setup (0–35) + IV alignment (0–25) + Entry quality (0–25) + Momentum (0–15)
- **Earnings proximity factor**: adjusts IV score ±3-5pts based on days to earnings (<7d or <21d)
- Setup types: Bull Put Spread, Call Spread, Long Call, Covered Call, Bear Call Spread, Bear Put Spread, Long Put, Iron Condor, Straddle, Calendar, Neutral
- High conviction threshold: score ≥ 75

#### Screener (`routes/screener.ts`)
- **Unified cache**: Single stale-while-revalidate cache (30-min TTL) shared across ALL endpoints
- Polygon path: snapshots for 3,489 stocks, full technicals (TECH lookback) for curated 477, basic estimates for the rest
- Yahoo fallback path: 477-symbol universe with full technicals
- Exports: `getScreenerData()`, `getScreenerRow(symbol)`, `ensureScreenerReady()` — consumed by `/stocks` route
- Stats endpoint `/api/screener/stats`: breadth, conviction count, IV averages, best score, market hours

#### Stocks Route (`routes/stocks.ts`)
- **When Polygon enabled**: `/stocks` and `/stocks/:symbol` both serve from the screener cache — same universe, same scores, no redundant computation, instant response after warmup
- **Fallback**: Live Yahoo Finance fetch with TECH lookback for the 477-symbol universe
- `screenerRowToStock()` adapter maps ScreenerRow → Stock response shape
- Price history endpoint still serves user-selected period (1D/1W/1M/3M/6M/1Y) separately

### Database (lib/db)
- `stocks` table: Legacy (market data served live from API)
- `watchlist` table: User watchlist entries (DB-backed)

### Data Flow (Polygon mode)
```
Startup → Polygon snapshots (11k tickers) → filter → 3,489 stocks
  → Full TECH-period technicals for 477 curated stocks (Yahoo Finance)
  → Basic estimated technicals for remaining 3,012 (price action only)
  → Cache stored in memory (30-min TTL, stale-while-revalidate)

/api/screener     → returns full 3,489-row cache
/api/screener/stats → computes breadth/conviction/IV from cache
/api/stocks       → serves from same cache (fast!)
/api/stocks/:sym  → screener cache lookup first, then live fallback
/api/dashboard/*  → uses /api/stocks which serves from cache
```

### Secrets Required
- `POLYGON_API_KEY` — Polygon.io Starter plan ($29/mo), 15-min delayed data
- `SESSION_SECRET` — Express session secret
- Schwab stub ready: `SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET`, `SCHWAB_REFRESH_TOKEN`

### Design System
- Background: `#0a0a0a`
- Primary: `hsl(217 91% 60%)` (Apple Blue)
- Fonts: Inter, tabular-nums for prices
- Radius: 8px, sentence-case labels, no emoji in code
