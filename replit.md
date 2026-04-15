# Options Platform

## Overview

A modern, Apple-inspired options trading analytics platform. Features a three-panel workspace with a live stock scanner, interactive candlestick/RSI/volume charts, OptionsPlay-style strategy recommendations with real scoring (0–200), and a Black-Scholes P&L simulator.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS, pure SVG charts
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec) — manually maintained schemas
- **Build**: esbuild (CJS bundle)
- **Market data**: `yahoo-finance2` (v3, class-based instantiation)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Architecture

### Frontend (artifacts/options-platform)
- **Workspace page** (`/`): Three-panel layout — stock scanner, candlestick/RSI chart, strategy panel + P&L simulator
- **Dashboard page** (`/dashboard`): Market overview with summary stats, top movers, and watchlist
- Charts: Pure SVG (no Recharts) — OHLCV candlesticks, RSI oscillator, volume bars, support/resistance levels

### Backend (artifacts/api-server)
- **market-data.ts**: Yahoo Finance integration with 5-min/30-min in-memory TTL cache. Real quotes, OHLCV history, historical volatility / IV Rank proxy. Ready to swap for Schwab API.
- **technical-analysis.ts**: RSI-14, MACD, SMA 20/50/200, ATR-14, volume ratio, swing-pivot S/R, composite strength score (0–10).
- **strategy-engine.ts**: OptionsPlay IV×Outlook matrix (Bull Put/Call Spread, Covered Call, Long Call, Iron Condor, Straddle, Calendar, Bear Put/Call Spread). Black-Scholes premium pricing. 4-factor score (0–200): R/R + Probability + IV Alignment + Technical Alignment.
- **schwab.ts**: Full Schwab OAuth2 adapter stub — ready for credentials (SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET, SCHWAB_REFRESH_TOKEN in Replit Secrets).
- Watchlist management (DB-backed)

### Database (lib/db)
- `stocks` table: Legacy — market data now served live from Yahoo Finance
- `watchlist` table: User watchlist entries

### Data Flow
1. `/api/stocks` → fetches real quotes for 30-symbol universe from Yahoo Finance, enriches with technical signals (cached 5 min)
2. `/api/stocks/:symbol` → full detail with computed RSI, MACD, S/R, IV Rank
3. `/api/stocks/:symbol/price-history` → real OHLCV candles (cached 30 min)
4. `/api/stocks/:symbol/strategies` → Black-Scholes derived strategies scored 0–200
5. `/api/stocks/:symbol/pnl` → real options P&L curve across price range

### Schwab API Setup (when credentials arrive)
Add to Replit Secrets:
- `SCHWAB_CLIENT_ID` — App Key from developer.schwab.com
- `SCHWAB_CLIENT_SECRET` — App Secret
- `SCHWAB_REDIRECT_URI` — your Replit domain + `/api/schwab/callback`
- `SCHWAB_REFRESH_TOKEN` — obtained after first OAuth flow via `/api/schwab/auth`

## Design
- Background: `hsl(0 0% 4%)` deep dark
- Primary: `hsl(217 91% 60%)` Apple Blue
- Font: Inter, tabular-nums for prices
- Radius: 8px
- All labels sentence-case, no ALL CAPS

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
