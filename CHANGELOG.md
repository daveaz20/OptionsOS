# Changelog

## 2026-04-16 — Scoring pipeline overhaul

### Bugs fixed

**`scanner.ts` — ReferenceError: price not defined in scoreMomentum** (`1cb3dbf`)
`scoreMomentum` referenced `price` on the ATR% line but `price` was never in its parameter list or closure. Every call to `scanOpportunity` threw a `ReferenceError`, silently caught, so every stock received the fallback score of 40/0/0/0/0. Fixed by adding `price: number` as a parameter and passing it from `scanOpportunity`.

**`scanner.ts` — VWAP scoring direction-blind** (`9405c19`)
`scoreVwap` checked `price > dayVwap` unconditionally regardless of the trade direction. On any up day, most stocks close above their VWAP, so virtually every stock received +10. Fixed: scoring is now direction-gated — bullish must be above VWAP, bearish must be below, neutral gets 0.

**`market-data.ts` — ivRank floating-point clamp to 0** (`9405c19`)
When `hv30` lands infinitesimally below `minHv` due to floating-point accumulation, `(hv30 - minHv) / (maxHv - minHv)` produces a tiny negative number, which `Math.max(0, ...)` clamped to 0. ivRank=0 then scored 25/25 for debit buying as "cheapest options ever". Fixed: clamp floor changed to 1.

**`market-data.ts` — ivRank NaN from empty windows array** (`c3d5487`)
When `closes.length < 32`, the rolling-windows loop never runs. `Math.min(...[])` = Infinity, `Math.max(...[])` = -Infinity. These are not equal, so the `maxHv === minHv ? 50` guard does not fire. `ivRank` becomes `NaN`, clamped to 0 by `Math.max(0, ...)`. Fixed: added explicit `if (windows.length === 0) return { ivRank: 50 }` guard before the min/max calculation.

**`market-data.ts` — getHistoricalVolatility throwing silently** (`78b5605`)
Yahoo Finance `chart()` calls were throwing (rate limits, unknown tickers) and propagating up through `Promise.all` in `buildKnownRows`. The outer `catch` block had no logging, so every failure produced a silent 40/0/0/0 fallback row. Fixed: wrapped the `yahooFinance.chart` call in its own try/catch returning a neutral fallback `{ ivRank: 50 }` so the rest of the scoring pipeline (Polygon bars + `computeSignals` + `scanOpportunity`) still runs.

**`screener.ts` — silent catch blocks** (`78b5605`)
Both `buildKnownRows` and `buildYahooData` catch blocks used bare `catch { }` with no error variable and no logging. Any throw was invisible. Fixed: both now log `[screener] technicals failed for TICKER: <message>`.

**`screener.ts` — /screener/stats returning 0 on cold start** (`9902182`)
The `/screener/stats` route was synchronous and read `cache.data` directly. On cold start, before the background refresh completed, it returned zeros for all counts including `highConviction`. Fixed: route made `async`, added `if (cache.data.length === 0) await triggerRefresh()` guard.

**`screener.ts` — withTechnicals filter using fragile rsi14 check** (`9902182`)
`withTechnicals` was filtered as `r.source !== "polygon" || r.rsi14 !== 50`. RSI=50 is a valid real value, so this incorrectly excluded real scored stocks. Fixed: changed to `r.opportunityScore !== 40` (40 is the actual sentinel value for fallback rows).

**`screener.ts` — high conviction threshold mismatch** (`9902182`)
Backend `/screener/stats` used threshold ≥75, but `StockListPanel.tsx` counted setups at ≥60. Fixed: standardised to ≥75 everywhere.

---

### Features added

**Conviction scoring: per-category minimums** (`9902182`)
Added `technicalScore`, `ivScore`, `entryScore`, `momentumScore` fields to `ScreenerRow`, populated from `scanOpportunity()` sub-scores. Added `isHighConviction()` helper requiring total ≥75 AND technical ≥20, IV ≥15, entry ≥15, momentum ≥8. A stock must pass all minimums to count as a high-conviction setup.

**Full-universe technicals** (`de5e78c`)
Removed the known/unknown split in `buildPolygonData`. Previously only the ~477 DEFAULT_UNIVERSE stocks received real technical analysis; the remaining ~4500+ quality stocks got estimated RSI/trend from price action alone. Now `getPolygonBars()` runs for every quality stock (CS/ADRC, price ≥$2, volume ≥100k). Batched at 15 concurrent with a 500ms delay between batches to stay within Polygon rate limits. Yahoo Finance `getQuotes` is still called for DEFAULT_UNIVERSE to populate fundamentals (P/E, beta, earnings date).

**VWAP scoring** (`de5e78c`, `9405c19`)
Captures `day.vw` and `prevDay.vw` from Polygon snapshots (already present in the response, just unused). Added `vwapScore` (0–10) to `ScanResult` and `ScreenerRow`. Scoring: +5 if price confirms VWAP in the trade direction for today's session, +5 if price confirms against yesterday's VWAP. Direction-gated: bullish above VWAP, bearish below, neutral 0.

---

### Infrastructure

**`scripts/dev-start.sh`** (`45cd385`)
Replaced `pkill -f "node"` (kills all node processes on the machine) with `fuser -k 3000/tcp && fuser -k 3001/tcp` (kills only processes bound to those ports).

**`lib/db/src/schema/screener-cache.ts`** (`4a92ad0`)
New Postgres table `screener_cache` (`id`, `payload jsonb`, `source text`, `cached_at timestamptz`). Screener results are persisted to the DB on each refresh and loaded on cold start (up to 4 hours stale). Prevents the scoring pipeline rebuild from blocking the first request after a restart.

---

### Files changed this session

| File | Changes |
|---|---|
| `artifacts/api-server/src/lib/scanner.ts` | Added `vwapScore` to `ScanResult`; added `scoreVwap()` with direction gating; fixed `scoreMomentum` missing `price` parameter; wired `dayVwap`/`prevDayVwap` into `scanOpportunity` |
| `artifacts/api-server/src/lib/market-data.ts` | `getHistoricalVolatility` no longer throws; empty-windows guard; ivRank floor 0→1 |
| `artifacts/api-server/src/routes/screener.ts` | `ScreenerRow` gains sub-score fields + `vwapScore`; removed `buildKnownRows`/`buildPolygonRow`; unified `buildPolygonData` loop; `isHighConviction()` per-category minimums; `/screener/stats` async with cache guard |
| `artifacts/options-platform/src/components/workspace/StockListPanel.tsx` | High conviction display threshold 60→75 |
| `lib/db/src/schema/screener-cache.ts` | New file — screener cache Postgres schema |
| `lib/db/src/schema/index.ts` | Export screener-cache schema |
| `scripts/dev-start.sh` | `pkill -f node` → `fuser -k 3000/tcp && fuser -k 3001/tcp` |
