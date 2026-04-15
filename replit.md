# Options Platform

## Overview

A modern options trading analytics platform inspired by OptionsPlay. Features a three-panel workspace with stock watchlist, interactive price charts, options strategy recommendations with scoring, and a P&L simulator.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS + Recharts
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Architecture

### Frontend (artifacts/options-platform)
- **Workspace page** (`/`): Three-panel layout with stock list, chart + detail, and strategies + P&L simulator
- **Dashboard page** (`/dashboard`): Market overview with summary stats, top movers, and watchlist

### Backend (artifacts/api-server)
- Stock listing and detail with search
- Watchlist management (add/remove)
- Options strategy generation with scoring
- P&L calculation and simulation
- Dashboard summary and top movers

### Database (lib/db)
- `stocks` table: Stock data with technical indicators
- `watchlist` table: User watchlist entries

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
