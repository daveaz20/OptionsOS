# OptionsOS — Claude Code Reference

## Read This First
This file is the single source of truth for the OptionsOS codebase. Read it entirely before writing any code. Do not modify production without explicit instruction. All feature work goes to `dev` branch first.

---

## Project Overview
OptionsOS is an options trading platform with a market screener, dashboard, watchlist, analysis tools, and strategy engine. Built as a TypeScript monorepo using pnpm workspaces.

---

## Infrastructure

| | Production | Beta |
|---|---|---|
| **URL** | https://optionsos.azeizat.com | https://beta.optionsos.azeizat.com |
| **Server** | DigitalOcean Droplet — 157.230.51.190 (Ubuntu 24.04) |  |
| **Code path** | `/var/www/optionsos` | `/var/www/optionsos-beta` |
| **API port** | 3000 | 3002 |
| **Frontend port** | 3001 | 3003 |
| **PM2 API process** | `optionsos-api` | `optionsos-beta-api` |
| **PM2 Frontend process** | `optionsos-frontend` | `optionsos-beta-frontend` |
| **Git branch** | `main` | `dev` |

**Web server:** nginx reverse proxy with Let's Encrypt SSL (cert covers optionsos.azeizat.com + beta.optionsos.azeizat.com + azeizat.com as SANs)  
**Config:** `/etc/nginx/sites-enabled/optionsos`  
**DNS:** Cloudflare — all records set to DNS Only (grey cloud, no proxy)

### Auto-Deploy (Production)
Pushing to `main` automatically deploys to production via GitHub Actions (`.github/workflows/deploy.yml`). It SSHes into the server using `secrets.DEPLOY_SSH_KEY`, pulls main, builds, copies `.env`, and restarts PM2. **Never push broken code directly to main.**

---

## Monorepo Structure

```
OptionsOS/
├── artifacts/
│   ├── api-server/          # Express backend
│   │   └── src/
│   │       ├── index.ts     # Entry point — reads PORT env var
│   │       ├── app.ts       # Express app setup, CORS, pino logging, /api router
│   │       ├── routes/
│   │       │   ├── index.ts
│   │       │   ├── dashboard.ts
│   │       │   ├── screener.ts
│   │       │   ├── stocks.ts
│   │       │   ├── strategies.ts
│   │       │   ├── watchlist.ts
│   │       │   └── health.ts
│   │       └── lib/
│   │           ├── polygon.ts         # Polygon.io API integration
│   │           ├── market-data.ts     # Market data aggregation
│   │           ├── scanner.ts         # Stock screener logic
│   │           ├── strategy-engine.ts # Options strategy scoring
│   │           ├── technical-analysis.ts
│   │           ├── schwab.ts          # Schwab integration (WIP)
│   │           └── logger.ts          # Pino logger
│   ├── options-platform/    # React frontend (Vite)
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── components/
│   │       │   ├── layout/  # Shell.tsx, GlobalSearch.tsx
│   │       │   └── ui/      # shadcn/ui components
│   │       ├── hooks/
│   │       └── lib/
│   └── mockup-sandbox/      # Design prototyping — do not deploy
├── lib/
│   └── db/                  # Drizzle ORM + PostgreSQL
│       ├── src/index.ts     # DB connection — requires DATABASE_URL
│       └── drizzle.config.ts
└── CLAUDE.md                # This file
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript |
| UI Components | shadcn/ui + Tailwind CSS |
| Backend | Express 5 + TypeScript |
| Database | PostgreSQL + Drizzle ORM |
| Package manager | pnpm (workspaces) |
| Process manager | PM2 |
| Market data | Polygon.io API |
| Brokerage | Tastytrade (connected), Schwab (WIP) |
| Logging | Pino |

---

## Environment Variables

All env vars live in `/var/www/optionsos/.env` (production — copied to `artifacts/api-server/.env` and `lib/db/.env` on every deploy) and `/var/www/optionsos-beta/ecosystem.config.cjs` (beta).

| Variable | Description |
|---|---|
| `DATABASE_URL` | `postgresql://optionsos_user:***@localhost:5432/optionsos_db` |
| `POLYGON_API_KEY` | Polygon.io API key |
| `PORT` | 3000 (prod) / 3002 (beta) |
| `BASE_PATH` | `/` |
| `TASTYTRADE_USERNAME` | Tastytrade login |
| `TASTYTRADE_PASSWORD` | Tastytrade password |
| `TASTYTRADE_ACCOUNT_NUMBER` | `5WI61720` |

---

## Key Rules

1. **Never commit `.env` files or credentials to GitHub**
2. **Never edit production directly** — build on `dev` branch, test on beta, merge to main, then deploy
3. **Always build before deploying** — the app is compiled, not run from source on the server
4. **DB schema changes** require running `pnpm --filter @workspace/db push` with DATABASE_URL set
5. **Both prod and beta share the same Polygon API key** — avoid restarting both simultaneously or you'll hit rate limits

---

## Deploy Commands

### Deploy to Production (AUTOMATIC)
Just push to `main` — GitHub Actions handles everything automatically.
```
git checkout main
git merge dev
git push origin main
```
The action pulls, builds, copies `.env`, and restarts PM2. Monitor at github.com/daveaz20/OptionsOS/actions.

### Deploy to Beta (MANUAL)
```bash
ssh root@157.230.51.190
cd /var/www/optionsos-beta
git pull origin dev
pnpm install
pnpm --filter api-server build
PORT=3002 BASE_PATH=/ pnpm --filter options-platform build
pm2 restart optionsos-beta-api --update-env
pm2 restart optionsos-beta-frontend
```

### DB Schema Push (after schema changes)
```bash
DATABASE_URL=postgresql://optionsos_user:Abmsec2008SA@localhost:5432/optionsos_db pnpm --filter @workspace/db push
```

### Check Server Status
```bash
pm2 list
pm2 logs optionsos-api --lines 20 --nostream
```

---

## API Routes

All routes are prefixed with `/api`

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/dashboard` | Dashboard market data |
| GET | `/api/screener` | Screener results |
| GET | `/api/stocks/:ticker` | Stock detail |
| GET | `/api/strategies` | Options strategies |
| GET/POST/DELETE | `/api/watchlist` | Watchlist management |

---

## Frontend Pages

| Page | Description |
|---|---|
| Dashboard | Market breadth, sector performance, IV distribution, top gainers/losers, watchlist |
| Screener | Filtered stock universe with scoring |
| Analysis | Options analysis and P&L calculator |

---

## Common Issues

| Issue | Fix |
|---|---|
| API shows 0 stocks | Polygon rate limit — wait 60s and refresh |
| 502 Bad Gateway | PM2 process crashed — check `pm2 logs` |
| SSL error on beta | Certbot cert covers beta as SAN — check nginx config points to `optionsos.azeizat.com` cert |
| DATABASE_URL not loading | Use ecosystem.config.cjs for beta, not just .env |
| `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` | Wrong filter name — use `@workspace/db` for db package |
