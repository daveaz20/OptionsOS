# Changelog

## 2026-04-16 — Full scoring pipeline overhaul

### Math audit — 6 bugs fixed (`214bbb0`)

**`strategy-engine.ts` — Iron Condor maxLoss 100× too large**
`wing` was already in $/contract (`(callShort - putShort) / 2 * 100`), then `maxLoss = wing * 100 - credit` multiplied by 100 again. Fixed: `maxLoss = wing - credit`. Cascaded into wrong `returnPercent`, `rrRatio`, and strategy score.

**`strategy-engine.ts` — Straddle stored upper breakeven**
Lower breakeven was `atmStrike + totalDebit / 100` (wrong sign). Fixed to `atmStrike - totalDebit / 100`.

**`market-data.ts` — IV Rank rolling window used 29 returns instead of 30**
`hv(30)` used 31 closes → 30 log-returns. Rolling windows loop used 30 closes → 29 log-returns. Inconsistent baseline made IV Rank meaningless. Fixed loop bounds to `i = 31; i <= closes.length` with 31-element slices.

**`technical-analysis.ts` — Volume ratio included today's volume in its own average**
`vols.slice(-20)` included today, inflating the ratio when today had high volume. Fixed: `vols.slice(-21, -1)` excludes the current bar.

**`scanner.ts` — ATR% used sma20 as denominator instead of price**
`atrPct = (signals.atr14 / signals.sma20) * 100` produced wrong ATR percentage when price diverged from SMA20. Fixed: `atrPct = (signals.atr14 / price) * 100`.

**`StrategyPanel.tsx` — Frontend normalCDF used truncated coefficients**
Abramowitz & Stegun coefficients were truncated to 5 significant figures, causing P&L curve divergence from the backend for deep ITM/OTM options. Fixed: full-precision coefficients (e.g. `0.319381530` not `0.31938`).

---

### Market data improvements (`4a92ad0`)

**Batch size 12 → 25** in both Yahoo and Polygon screener loops.

**Screener cache persisted to Postgres** (`screener_cache` table). On restart the server warms from DB (up to 4 hours stale) before triggering a fresh network fetch, so the first request is never blocked. Write is fire-and-forget.

**Dead Polygon functions removed** — `getPolygonRSI`, `getPolygonMACD`, `getPolygonSnapshot` were defined but never called. Deleted.

**Polygon technicals switched from Yahoo `getPriceHistory` to `getPolygonBars(580d)`** for the known universe. Fixed bars fetch limit 300 → 600 (covers 580 calendar days ≈ 414 trading days, enough for SMA200 warmup). Added 30-min in-memory cache per symbol.

---

### Scoring pipeline bugs fixed

**`scanner.ts` — ReferenceError: price not defined in scoreMomentum** (`1cb3dbf`)
`scoreMomentum` referenced `price` on the ATR% line but it was never a parameter. Every `scanOpportunity()` call threw a `ReferenceError`, silently caught, so every stock received the fallback 40/0/0/0. Fixed: added `price: number` parameter.

**`scanner.ts` — VWAP scoring direction-blind** (`9405c19`)
`scoreVwap` checked `price > dayVwap` unconditionally. On any up day most stocks close above VWAP, so virtually every stock received +10. Fixed: direction-gated — bullish must be above VWAP, bearish must be below, neutral gets 0.

**`market-data.ts` — ivRank NaN from empty windows array** (`c3d5487`)
When `closes.length < 32`, the rolling loop never runs. `Math.min(...[])` = Infinity, `Math.max(...[])` = -Infinity — not equal, so the `maxHv === minHv ? 50` guard doesn't fire. `ivRank` becomes NaN, clamped to 0. Fixed: added `if (windows.length === 0) return { ivRank: 50 }` before the spread.

**`market-data.ts` — ivRank floating-point clamp producing 0** (`9405c19`)
FP accumulation can land `hv30` infinitesimally below `minHv`, giving a tiny negative ivRank that `Math.max(0, ...)` clamped to 0. ivRank=0 then scored 25/25 for debit buying. Fixed: floor raised to 1.

**`market-data.ts` — getHistoricalVolatility throwing silently** (`78b5605`)
Yahoo Finance `chart()` rate-limit errors propagated through `Promise.all`, swallowed by bare `catch {}`, producing silent 40/0/0/0 fallback rows. Fixed: wrapped the fetch in its own try/catch returning `{ ivRank: 50 }` so Polygon bars + signal computation still run.

**`screener.ts` — silent catch blocks** (`78b5605`)
Both catch blocks used `catch { }` with no variable and no logging. Fixed: now log `[screener] technicals failed for TICKER: <message>`.

**`screener.ts` — /screener/stats returning 0 on cold start** (`9902182`)
Route was synchronous and read `cache.data` directly before the background refresh completed. Fixed: made async, added `if (cache.data.length === 0) await triggerRefresh()`.

**`screener.ts` — withTechnicals filter excluding real scored stocks** (`9902182`)
Filter used `r.rsi14 !== 50` to detect fallback rows, but RSI=50 is a valid real value. Fixed: changed to `r.opportunityScore !== 40` (40 is the actual sentinel).

**`screener.ts` — high conviction threshold mismatch** (`9902182`)
Backend `/screener/stats` used ≥75, `StockListPanel.tsx` displayed ≥60. Fixed: standardised to ≥75 everywhere.

---

### Features added

**Per-category conviction minimums** (`9902182`)
Added `technicalScore`, `ivScore`, `entryScore`, `momentumScore` to `ScreenerRow`. `isHighConviction()` requires total ≥75 AND tech ≥20, IV ≥15, entry ≥15, momentum ≥8.

**Full-universe technicals** (`de5e78c`)
Removed the known/unknown split. Previously ~4500+ Polygon-only stocks got estimated scores from price action. Now `getPolygonBars()` runs for every quality stock (CS/ADRC, price ≥$2, volume ≥100k). Batched 15 concurrent with 500ms inter-batch delay. Yahoo Finance `getQuotes` still runs for DEFAULT_UNIVERSE for P/E, beta, earnings date.

**VWAP scoring** (`de5e78c`, `9405c19`)
Captures `day.vw` and `prevDay.vw` from Polygon snapshot. Added `vwapScore` (0–10) to `ScanResult` and `ScreenerRow`. Direction-gated: +5 each for day and prevDay VWAP confirmation.

---

### Infrastructure

**`scripts/dev-start.sh`** (`45cd385`)
Replaced `pkill -f "node"` with `fuser -k 3000/tcp && fuser -k 3001/tcp`.

**`scripts/session-end.md`** (`4452172`)
New file — checklist for ending dev sessions: update CHANGELOG, commit/push, print Project Knowledge summary block.

---

### All files changed this session

| File | Changes |
|---|---|
| `artifacts/api-server/src/lib/strategy-engine.ts` | Iron Condor maxLoss ÷100, Straddle lower breakeven |
| `artifacts/api-server/src/lib/technical-analysis.ts` | Volume ratio excludes today's bar |
| `artifacts/api-server/src/lib/market-data.ts` | IV Rank window fix; no-throw HV; empty-windows guard; ivRank floor 0→1 |
| `artifacts/api-server/src/lib/scanner.ts` | ATR% denominator fix; `price` param in `scoreMomentum`; `vwapScore` + direction-gated `scoreVwap` |
| `artifacts/api-server/src/lib/polygon.ts` | Dead functions removed; bars limit 300→600; 30min bars cache |
| `artifacts/api-server/src/routes/screener.ts` | Sub-scores + `vwapScore` in `ScreenerRow`; unified polygon loop (15/batch, 500ms); DB persistence; `isHighConviction`; stats cache guard |
| `artifacts/options-platform/src/components/workspace/StrategyPanel.tsx` | Full-precision normalCDF coefficients |
| `artifacts/options-platform/src/components/workspace/StockListPanel.tsx` | High conviction threshold 60→75 |
| `lib/db/src/schema/screener-cache.ts` | New — Postgres screener cache schema |
| `lib/db/src/schema/index.ts` | Export screener-cache |
| `scripts/dev-start.sh` | `pkill` → `fuser -k` |
| `scripts/session-end.md` | New — session end checklist |
