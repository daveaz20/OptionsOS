import { useEffect, useState, type ReactNode } from "react";
import { useGetStock, useGetStockPriceHistory, useGetWatchlist, useAddToWatchlist, useRemoveFromWatchlist, getGetWatchlistQueryKey } from "@workspace/api-client-react";
import { AlertCircle, BarChart2, Bookmark, BookmarkCheck, TrendingDown, TrendingUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatNumber, formatPercent, useFormats } from "@/lib/format";
import { useSettings } from "@/contexts/SettingsContext";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import type { PricePoint } from "@workspace/api-client-react";


interface StockDetailPanelProps {
  symbol: string;
}

const PERIODS = ["1D", "1W", "1M", "3M", "6M", "1Y", "2Y"] as const;
type Period = (typeof PERIODS)[number];

function parseEarningsDate(value?: string): Date | null {
  if (!value || value === "TBD") return null;
  const date = new Date(value);
  const currentYear = new Date().getFullYear();
  if (Number.isNaN(date.getTime()) || date.getFullYear() < currentYear - 1) return null;
  return date;
}

function getEarningsInfo(earningsDate: string | undefined, eps: number, warningWindow: number) {
  const date = parseEarningsDate(earningsDate);
  if (!date) {
    return {
      value: "TBD",
      sub: "No confirmed upcoming report date",
      detail: `Trailing EPS ${eps.toFixed(2)}`,
      tone: "neutral" as const,
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const reportDay = new Date(date);
  reportDay.setHours(0, 0, 0, 0);
  const days = Math.round((reportDay.getTime() - today.getTime()) / 86_400_000);
  const value = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const timing =
    days === 0 ? "Reports today" :
    days === 1 ? "Reports tomorrow" :
    days > 1 ? `Reports in ${days} days` :
    `Reported ${Math.abs(days)} days ago`;
  const tone = days >= 0 && days <= warningWindow ? "warn" : days < 0 ? "muted" : "neutral";

  return {
    value,
    sub: timing,
    detail: `Trailing EPS ${eps.toFixed(2)} | Earnings risk window ${warningWindow}d`,
    tone,
  };
}

export function StockDetailPanel({ symbol }: StockDetailPanelProps) {
  const { settings } = useSettings();
  const [period, setPeriod] = useState<Period>((PERIODS.includes(settings.defaultChartPeriod as Period) ? settings.defaultChartPeriod : "1M") as Period);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const quoteRefreshMs =
    settings.autoRefresh && !settings.disableStreamer
      ? Math.max(2_000, Math.min(3_000, Number(settings.autoRefreshInterval || 60) * 1000))
      : false;

  useEffect(() => {
    const next = PERIODS.includes(settings.defaultChartPeriod as Period) ? settings.defaultChartPeriod as Period : "1M";
    setPeriod(next);
  }, [settings.defaultChartPeriod, symbol]);

  const { data: stock, isLoading: isLoadingStock } = useGetStock(symbol, {
    query: {
      enabled: !!symbol,
      refetchInterval: quoteRefreshMs,
      refetchIntervalInBackground: true,
    },
  });
  const { data: history = [], isLoading: isLoadingHistory } = useGetStockPriceHistory(symbol, { period }, { query: { enabled: !!symbol } });
  const { data: watchlist = [] } = useGetWatchlist();
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();

  const watchlistItem = watchlist.find((w) => w.symbol === symbol);
  const isWatched = !!watchlistItem;

  const handleWatchlistToggle = () => {
    if (isWatched && watchlistItem) {
      removeFromWatchlist.mutate({ id: watchlistItem.id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
          toast({ title: `Removed from watchlist`, description: symbol });
        },
      });
    } else {
      addToWatchlist.mutate({ data: { symbol } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
          toast({ title: `Added to watchlist`, description: symbol });
        },
      });
    }
  };

  if (!symbol) {
    return (
      <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, background: "hsl(var(--background))", color: "hsl(var(--muted-foreground))" }}>
        <BarChart2 style={{ width: 28, height: 28, opacity: 0.2 }} />
        <p style={{ fontSize: 13 }}>Select a stock to analyze</p>
      </div>
    );
  }

  if (isLoadingStock) {
    return (
      <div style={{ height: "100%", overflowY: "auto", padding: "24px 28px", background: "hsl(var(--background))" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton className="h-9 w-28 bg-white/5" />
            <Skeleton className="h-4 w-44 bg-white/5" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            <Skeleton className="h-9 w-28 bg-white/5" />
            <Skeleton className="h-4 w-32 bg-white/5" />
          </div>
        </div>
        <Skeleton className="h-[400px] w-full bg-white/5 rounded-lg" />
      </div>
    );
  }

  if (!stock) {
    return (
      <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "hsl(var(--muted-foreground))" }}>
        <AlertCircle style={{ width: 22, height: 22, opacity: 0.4 }} />
        <p style={{ fontSize: 13 }}>Failed to load {symbol}</p>
      </div>
    );
  }

  const isUp = stock.change >= 0;
  const quote = stock as any;
  const quoteSource =
    quote.priceSource === "tastytrade-live" ? "Tastytrade live" :
    quote.priceSource === "tastytrade-rest" ? "Tastytrade quote" :
    quote.source === "polygon-eod" ? "Polygon EOD" :
    quote.source === "polygon" ? "Polygon" :
    "Market data";
  const relVol = Number(quote.relVol ?? (stock.volume && quote.avgVolume ? stock.volume / quote.avgVolume : 0));
  const dayRangePct = stock.fiftyTwoWeekHigh > stock.fiftyTwoWeekLow
    ? Math.max(0, Math.min(100, ((stock.price - stock.fiftyTwoWeekLow) / (stock.fiftyTwoWeekHigh - stock.fiftyTwoWeekLow)) * 100))
    : 50;
  const earningsInfo = getEarningsInfo(stock.earningsDate, stock.eps, settings.earningsAvoidanceBeforeDays);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "hsl(var(--background))" }}>
      <ScrollArea className="flex-1">
        <div style={{ padding: "28px 32px 40px", width: "100%" }}>

          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, gap: 24 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
                <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.04em", color: "hsl(var(--foreground))", lineHeight: 1 }}>
                  {stock.symbol}
                </h1>
                <span style={{
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0",
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: "1px solid rgba(255,255,255,0.09)",
                  color: "hsl(var(--muted-foreground))",
                }}>
                  {stock.sector}
                </span>
                {stock.opportunityScore != null && (
                  <span style={{
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    fontVariantNumeric: "tabular-nums",
                    padding: "3px 10px",
                    borderRadius: 6,
                    color: stock.opportunityScore >= 90 ? "#4ade80"
                         : stock.opportunityScore >= 75 ? "#22c55e"
                         : stock.opportunityScore >= 50 ? "#facc15"
                         : "#f87171",
                    background: stock.opportunityScore >= 90 ? "rgba(74,222,128,0.12)"
                              : stock.opportunityScore >= 75 ? "rgba(34,197,94,0.10)"
                              : stock.opportunityScore >= 50 ? "rgba(250,204,21,0.10)"
                              : "rgba(248,113,113,0.10)",
                    border: `1px solid ${
                      stock.opportunityScore >= 90 ? "rgba(74,222,128,0.3)"
                    : stock.opportunityScore >= 75 ? "rgba(34,197,94,0.25)"
                    : stock.opportunityScore >= 50 ? "rgba(250,204,21,0.25)"
                    : "rgba(248,113,113,0.25)"}`,
                  }}>
                    {stock.opportunityScore}
                  </span>
                )}
                <ActionBtn
                  active={isWatched}
                  onClick={handleWatchlistToggle}
                  disabled={addToWatchlist.isPending || removeFromWatchlist.isPending}
                  activeIcon={<BookmarkCheck style={{ width: 11, height: 11 }} />}
                  inactiveIcon={<Bookmark style={{ width: 11, height: 11 }} />}
                  activeLabel="Watching"
                  inactiveLabel="+ Watchlist"
                  activeColor="hsl(var(--primary))"
                />
              </div>
              <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", fontWeight: 400 }}>{stock.name}</p>
            </div>

            <div style={{ textAlign: "right", minWidth: 280 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 6 }}>
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 8px",
                  borderRadius: 999,
                  background: quote.priceSource === "tastytrade-live" ? "hsl(var(--success) / 0.10)" : "rgba(255,255,255,0.05)",
                  border: quote.priceSource === "tastytrade-live" ? "1px solid hsl(var(--success) / 0.24)" : "1px solid rgba(255,255,255,0.08)",
                  color: quote.priceSource === "tastytrade-live" ? "hsl(var(--success))" : "hsl(var(--muted-foreground))",
                  fontSize: 11,
                  fontWeight: 700,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                  {quoteSource}
                </span>
              </div>
              <div style={{ fontSize: 36, fontWeight: 750, letterSpacing: "-0.04em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {formatCurrency(stock.price)}
              </div>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 4,
                marginTop: 5,
                fontSize: 13,
                fontWeight: 500,
                color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))",
                fontVariantNumeric: "tabular-nums",
              }}>
                {isUp ? <TrendingUp style={{ width: 14, height: 14 }} /> : <TrendingDown style={{ width: 14, height: 14 }} />}
                {isUp ? "+" : ""}{formatCurrency(stock.change)} ({formatPercent(Math.abs(stock.changePercent))})
              </div>
            </div>
          </div>

          {/* Quote workup */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
            gap: 8,
            marginBottom: 20,
          }}>
            <QuoteStat label="Volume" value={formatNumber(stock.volume)} sub={relVol > 0 ? `${relVol.toFixed(2)}x rel vol` : "relative volume"} />
            <QuoteStat label="Market Cap" value={formatNumber(stock.marketCap)} sub={stock.sector || "sector"} />
            <QuoteStat label="IV Rank" value={`${Math.round(stock.ivRank ?? 0)}%`} tone={(stock.ivRank ?? 0) >= 50 ? "warn" : "neutral"} sub="options regime" />
            <QuoteStat label="Tech Strength" value={`${stock.technicalStrength}/10`} tone={stock.technicalStrength >= 7 ? "good" : stock.technicalStrength <= 3 ? "bad" : "neutral"} sub="trend score" />
            <QuoteStat label="P/E" value={stock.pe > 0 ? stock.pe.toFixed(1) : "N/A"} sub={quote.forwardPE > 0 ? `${quote.forwardPE.toFixed(1)} fwd` : "forward N/A"} />
            <QuoteStat label="52W Position" value={`${Math.round(dayRangePct)}%`} sub={`${formatCurrency(stock.fiftyTwoWeekLow)} - ${formatCurrency(stock.fiftyTwoWeekHigh)}`} />
          </div>

          {/* Chart card */}
          <div style={{
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.07)",
            background: "rgba(255,255,255,0.018)",
            overflow: "hidden",
            marginBottom: 20,
          }}>
            {/* Chart toolbar */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.01em" }}>Technical Analysis</span>
                <div style={{ display: "flex", gap: 10, fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
                  <LegendDot color="hsl(var(--success))" label="Bull" />
                  <LegendDot color="hsl(var(--destructive))" label="Bear" />
                  <LegendDot color="hsl(var(--primary))" label="MA" />
                </div>
              </div>
              <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: 2 }}>
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    style={{
                      padding: "4px 9px",
                      borderRadius: 4,
                      border: "none",
                      fontSize: 11,
                      fontWeight: period === p ? 600 : 400,
                      color: period === p ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                      background: period === p ? "rgba(255,255,255,0.10)" : "transparent",
                      cursor: "pointer",
                      transition: "all 0.12s",
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Chart area */}
            <div style={{ height: settings.chartHeight === "compact" ? 300 : settings.chartHeight === "expanded" ? 520 : 400, position: "relative" }}>
              {isLoadingHistory ? (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid transparent", borderBottomColor: "hsl(var(--primary))", animation: "spin 0.8s linear infinite" }} />
                </div>
              ) : (
                <TechnicalChart data={history} stock={stock as any} support={stock.supportPrice} resistance={stock.resistancePrice} isUp={isUp} />
              )}
            </div>

            {/* Signal strip */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              {[
                { label: "Trend", value: (stock as any).recommendedOutlook === "bullish" ? "Bullish" : (stock as any).recommendedOutlook === "bearish" ? "Bearish" : "Neutral", color: (stock as any).recommendedOutlook === "bullish" ? "hsl(var(--success))" : (stock as any).recommendedOutlook === "bearish" ? "hsl(var(--destructive))" : "hsl(var(--primary))" },
                { label: "Support", value: formatCurrency(stock.supportPrice), color: "hsl(var(--success))" },
                { label: "Resistance", value: formatCurrency(stock.resistancePrice), color: "hsl(var(--destructive))" },
                { label: "IV Rank", value: `${stock.ivRank}%`, color: stock.ivRank >= 40 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" },
              ].map((s, i) => (
                <div key={i} style={{ padding: "10px 16px", borderRight: i < 3 ? "1px solid rgba(255,255,255,0.05)" : undefined }}>
                  <div style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))", fontWeight: 400, marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: s.color, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Stats grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 20 }}>
            <StatCard label="Technical Strength" value={`${stock.technicalStrength}/10`} valueColor={stock.technicalStrength >= 7 ? "hsl(var(--success))" : stock.technicalStrength <= 3 ? "hsl(var(--destructive))" : "hsl(var(--primary))"} />
            <StatCard label="Relative Strength" value={String(stock.relativeStrength)} />
            <StatCard label="Market Cap" value={formatNumber(stock.marketCap)} />
            <StatCard label="Volume" value={formatNumber(stock.volume)} />
            <StatCard label="52W High" value={formatCurrency(stock.fiftyTwoWeekHigh)} />
            <StatCard label="52W Low" value={formatCurrency(stock.fiftyTwoWeekLow)} />
            <StatCard label="P/E Ratio" value={stock.pe.toFixed(1)} />
            <StatCard label="Dividend Yield" value={formatPercent(stock.dividendYield * 100)} />
          </div>

          {/* Footer cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <EarningsInfoCard info={earningsInfo} />
            <InfoCard label="Price Action" value={stock.priceAction} />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function QuoteStat({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" | "neutral" }) {
  const color =
    tone === "good" ? "hsl(var(--success))" :
    tone === "bad" ? "hsl(var(--destructive))" :
    tone === "warn" ? "hsl(38 92% 50%)" :
    "hsl(var(--foreground))";

  return (
    <div style={{
      minWidth: 0,
      padding: "12px 13px",
      borderRadius: 8,
      border: "1px solid rgba(255,255,255,0.07)",
      background: "rgba(255,255,255,0.025)",
    }}>
      <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontWeight: 650, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 17, color, fontWeight: 750, fontVariantNumeric: "tabular-nums", lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))", marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
    </div>
  );
}

function TechnicalChart({ data, stock, support, resistance, isUp }: { data: PricePoint[]; stock: any; support: number; resistance: number; isUp: boolean }) {
  const { settings } = useSettings();
  const { fmtCurrency } = useFormats();
  const rsiOverbought = settings.rsiOverbought;
  const rsiOversold = settings.rsiOversold;
  const W = 900;
  const H = 400;
  const PT = 24;
  const showRsi = settings.showRsiPanel;
  const showMacd = settings.showMacdPanel;
  const showAtr = settings.showAtrPanel;
  const indicatorCount = (showRsi ? 1 : 0) + (showMacd ? 1 : 0) + (showAtr ? 1 : 0);
  const PH = settings.showVolumeOnChart ? (indicatorCount ? 206 : 286) : (indicatorCount ? 250 : 336);
  const VT = PT + PH + 16, VH = settings.showVolumeOnChart ? 46 : 0;
  const indicatorTop = VT + VH + (settings.showVolumeOnChart ? 18 : 0);
  const indicatorHeight = indicatorCount ? Math.max(34, Math.floor((H - indicatorTop - 14) / indicatorCount)) : 0;
  const PL = 14, PR = 58;
  const CW = W - PL - PR;

  if (!data.length) return <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "hsl(var(--muted-foreground))" }}>No data</div>;

  const lows = data.map((d) => d.low);
  const highs = data.map((d) => d.high);
  const rawMin = settings.autoFitChartToPrice ? Math.min(...lows, support) : Math.min(...lows, support, stock.fiftyTwoWeekLow ?? Infinity);
  const rawMax = settings.autoFitChartToPrice ? Math.max(...highs, resistance) : Math.max(...highs, resistance, stock.fiftyTwoWeekHigh ?? 0);
  const pMin = rawMin * 0.984;
  const pMax = rawMax * 1.016;
  const maxVol = Math.max(...data.map((d) => d.volume), 1);
  const cw = Math.max(2, Math.min(11, (CW / data.length) * 0.55));
  const xStep = CW / Math.max(data.length - 1, 1);
  const closes = data.map((d) => d.close);
  const sma20 = movingAverage(closes, Math.min(20, Math.max(2, data.length)));
  const sma50 = movingAverage(closes, Math.min(50, Math.max(2, data.length)));
  const sma200 = movingAverage(closes, Math.min(200, Math.max(2, data.length)));
  const ema9 = emaSeries(closes, Math.min(9, Math.max(2, data.length)));
  const ema21 = emaSeries(closes, Math.min(21, Math.max(2, data.length)));
  const vwap = vwapSeries(data);
  const bollMid = movingAverage(closes, Math.min(20, Math.max(2, data.length)));
  const bollUpper = bollMid.map((m, i) => m == null ? null : m + stddev(closes.slice(Math.max(0, i - 19), i + 1)) * 2);
  const bollLower = bollMid.map((m, i) => m == null ? null : m - stddev(closes.slice(Math.max(0, i - 19), i + 1)) * 2);
  const rsi = rsiCalc(data.map((d) => d.close));
  const macd = macdSeries(closes);
  const atr = atrSeries(data);

  const x = (i: number) => PL + i * xStep;
  const py = (p: number) => PT + ((pMax - p) / (pMax - pMin || 1)) * PH;
  const vy = (v: number) => VT + VH - (v / maxVol) * VH;
  const panelY = (panelIndex: number) => indicatorTop + panelIndex * indicatorHeight;
  const panelScale = (value: number, min: number, max: number, top: number) => top + ((max - value) / (max - min || 1)) * (indicatorHeight - 8) + 4;

  const sy = py(support);
  const ry2 = py(resistance);
  const last = data[data.length - 1];

  const pricePath = pathFor(data.map(d => d.close), py, x);
  const sma20Path = pathForNullable(sma20, py, x);
  const sma50Path = pathForNullable(sma50, py, x);
  const sma200Path = pathForNullable(sma200, py, x);
  const ema9Path = pathForNullable(ema9, py, x);
  const ema21Path = pathForNullable(ema21, py, x);
  const vwapPath = pathForNullable(vwap, py, x);
  const bollUpperPath = pathForNullable(bollUpper, py, x);
  const bollLowerPath = pathForNullable(bollLower, py, x);
  const rsiPanelIndex = 0;
  const macdPanelIndex = (showRsi ? 1 : 0);
  const atrPanelIndex = (showRsi ? 1 : 0) + (showMacd ? 1 : 0);
  const rsiTop = panelY(rsiPanelIndex);
  const macdTop = panelY(macdPanelIndex);
  const atrTop = panelY(atrPanelIndex);
  const rsiPath = pathFor(rsi, (v) => panelScale(v, 0, 100, rsiTop), x);
  const macdMin = Math.min(...macd), macdMax = Math.max(...macd);
  const atrMin = Math.min(...atr), atrMax = Math.max(...atr);
  const macdPath = pathFor(macd, (v) => panelScale(v, macdMin, macdMax, macdTop), x);
  const atrPath = pathFor(atr, (v) => panelScale(v, atrMin, atrMax, atrTop), x);

  const gridPrices = Array.from({ length: 5 }, (_, i) => pMin + (pMax - pMin) * (i / 4));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none" aria-label="Technical chart">
      <defs>
        <linearGradient id="maGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={isUp ? "hsl(var(--success))" : "hsl(var(--destructive))"} stopOpacity="0.10" />
          <stop offset="100%" stopColor="transparent" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid */}
      {gridPrices.map((p) => (
        <g key={p}>
          <line x1={PL} x2={W - PR} y1={py(p)} y2={py(p)} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 6" />
          <text x={W - PR + 8} y={py(p) + 4} fill="rgba(255,255,255,0.35)" fontSize="9.5" fontFamily="var(--app-font-mono)">{fmtCurrency(p)}</text>
        </g>
      ))}

      {/* Support / Resistance */}
      {settings.showSupportResistanceLines && (
        <>
          <line x1={PL} x2={W - PR} y1={sy} y2={sy} stroke="hsl(var(--success))" strokeOpacity="0.5" strokeDasharray="6 6" />
          <text x={PL + 4} y={sy - 5} fill="hsl(var(--success))" fillOpacity="0.8" fontSize="9" fontFamily="var(--app-font-mono)">S {fmtCurrency(support)}</text>
          <line x1={PL} x2={W - PR} y1={ry2} y2={ry2} stroke="hsl(var(--destructive))" strokeOpacity="0.5" strokeDasharray="6 6" />
          <text x={PL + 4} y={ry2 - 5} fill="hsl(var(--destructive))" fillOpacity="0.8" fontSize="9" fontFamily="var(--app-font-mono)">R {fmtCurrency(resistance)}</text>
        </>
      )}
      {settings.show52WeekHighLowLines && stock.fiftyTwoWeekHigh > 0 && stock.fiftyTwoWeekLow > 0 && (
        <>
          <line x1={PL} x2={W - PR} y1={py(stock.fiftyTwoWeekHigh)} y2={py(stock.fiftyTwoWeekHigh)} stroke="rgba(255,255,255,0.18)" strokeDasharray="2 5" />
          <line x1={PL} x2={W - PR} y1={py(stock.fiftyTwoWeekLow)} y2={py(stock.fiftyTwoWeekLow)} stroke="rgba(255,255,255,0.18)" strokeDasharray="2 5" />
        </>
      )}
      {settings.showBollingerBands && bollUpperPath && bollLowerPath && (
        <>
          <path d={bollUpperPath} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="4 5" />
          <path d={bollLowerPath} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="4 5" />
        </>
      )}

      {settings.chartStyle === "area" && <path d={`${pricePath} L ${x(data.length - 1)} ${PT + PH} L ${x(0)} ${PT + PH} Z`} fill="url(#maGrad)" />}

      {/* Price */}
      {settings.chartStyle === "line" || settings.chartStyle === "area" ? (
        <path d={pricePath} fill="none" stroke={isUp ? "hsl(var(--success))" : "hsl(var(--destructive))"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      ) : data.map((d, i) => {
        const bull = d.close >= d.open;
        const cx = x(i);
        const oy = py(d.open), cy2 = py(d.close), hy = py(d.high), ly = py(d.low);
        const by = Math.min(oy, cy2);
        const bh = Math.max(1.5, Math.abs(oy - cy2));
        const col = bull ? "hsl(var(--success))" : "hsl(var(--destructive))";
        return (
          <g key={i} opacity={0.9}>
            <line x1={cx} x2={cx} y1={hy} y2={ly} stroke={col} strokeWidth="1" strokeOpacity="0.7" />
            {settings.chartStyle === "ohlc" ? (
              <>
                <line x1={cx - cw / 2} x2={cx} y1={oy} y2={oy} stroke={col} strokeWidth="1" />
                <line x1={cx} x2={cx + cw / 2} y1={cy2} y2={cy2} stroke={col} strokeWidth="1" />
              </>
            ) : (
              <rect x={cx - cw / 2} y={by} width={cw} height={bh} rx="1" fill={col} fillOpacity={bull ? 0.75 : 0.8} />
            )}
            {settings.showVolumeOnChart && <rect x={cx - cw / 2} y={vy(d.volume)} width={cw} height={VT + VH - vy(d.volume)} fill={col} fillOpacity="0.18" />}
          </g>
        );
      })}

      {/* Indicator lines */}
      {settings.showSMA20 && sma20Path && <path d={sma20Path} fill="none" stroke={settings.sma20Color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
      {settings.showSMA50 && sma50Path && <path d={sma50Path} fill="none" stroke={settings.sma50Color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
      {settings.showSMA200 && sma200Path && <path d={sma200Path} fill="none" stroke={settings.sma200Color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
      {settings.showEMA9 && ema9Path && <path d={ema9Path} fill="none" stroke={settings.ema9Color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 4" />}
      {settings.showEMA21 && ema21Path && <path d={ema21Path} fill="none" stroke={settings.ema21Color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 4" />}
      {settings.showVWAPLine && vwapPath && <path d={vwapPath} fill="none" stroke={settings.vwapColor} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 5" />}

      {/* Volume label */}
      {settings.showVolumeOnChart && (
        <>
          <line x1={PL} x2={W - PR} y1={VT} y2={VT} stroke="rgba(255,255,255,0.06)" />
          <text x={PL} y={VT - 5} fill="rgba(255,255,255,0.3)" fontSize="8.5" fontFamily="var(--app-font-sans)">Vol</text>
        </>
      )}

      {/* RSI */}
      {showRsi && (
        <>
          <rect x={PL} y={rsiTop} width={CW} height={indicatorHeight} fill="rgba(255,255,255,0.018)" rx="3" />
          <line x1={PL} x2={W - PR} y1={panelScale(rsiOverbought, 0, 100, rsiTop)} y2={panelScale(rsiOverbought, 0, 100, rsiTop)} stroke="hsl(var(--destructive))" strokeOpacity="0.22" strokeDasharray="4 5" />
          <line x1={PL} x2={W - PR} y1={panelScale(rsiOversold, 0, 100, rsiTop)} y2={panelScale(rsiOversold, 0, 100, rsiTop)} stroke="hsl(var(--success))" strokeOpacity="0.22" strokeDasharray="4 5" />
          <path d={rsiPath} fill="none" stroke="hsl(262 80% 65%)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
          <text x={PL} y={rsiTop - 5} fill="rgba(255,255,255,0.3)" fontSize="8.5" fontFamily="var(--app-font-sans)">RSI</text>
        </>
      )}
      {showMacd && (
        <>
          <rect x={PL} y={macdTop} width={CW} height={indicatorHeight} fill="rgba(255,255,255,0.018)" rx="3" />
          <path d={macdPath} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.4" />
          <text x={PL} y={macdTop - 5} fill="rgba(255,255,255,0.3)" fontSize="8.5" fontFamily="var(--app-font-sans)">MACD</text>
        </>
      )}
      {showAtr && (
        <>
          <rect x={PL} y={atrTop} width={CW} height={indicatorHeight} fill="rgba(255,255,255,0.018)" rx="3" />
          <path d={atrPath} fill="none" stroke="hsl(38 92% 50%)" strokeWidth="1.4" />
          <text x={PL} y={atrTop - 5} fill="rgba(255,255,255,0.3)" fontSize="8.5" fontFamily="var(--app-font-sans)">ATR</text>
        </>
      )}

      {/* Current price marker */}
      {settings.showEarningsMarkersOnChart && parseEarningsDate(stock.earningsDate) && (
        <line x1={W - PR - 34} x2={W - PR - 34} y1={PT} y2={PT + PH} stroke="hsl(38 92% 50%)" strokeOpacity="0.38" strokeDasharray="4 5" />
      )}
      {settings.showStrategyPriceLevels && (
        <>
          <line x1={PL} x2={W - PR} y1={py(last.close * 1.08)} y2={py(last.close * 1.08)} stroke="hsl(var(--primary))" strokeOpacity="0.22" strokeDasharray="8 6" />
          <line x1={PL} x2={W - PR} y1={py(last.close * 0.94)} y2={py(last.close * 0.94)} stroke="hsl(var(--destructive))" strokeOpacity="0.22" strokeDasharray="8 6" />
        </>
      )}
      {settings.showBreakevenLines && <line x1={PL} x2={W - PR} y1={py(last.close)} y2={py(last.close)} stroke="rgba(255,255,255,0.20)" strokeDasharray="3 5" />}
      {settings.showPositionPnlOverlay && (
        <text x={PL + 4} y={PT + 12} fill="rgba(255,255,255,0.45)" fontSize="9" fontFamily="var(--app-font-sans)">Position P&L overlay ready</text>
      )}
      <line x1={x(data.length - 1)} x2={x(data.length - 1)} y1={PT} y2={indicatorCount ? indicatorTop + indicatorCount * indicatorHeight : PT + PH} stroke="rgba(255,255,255,0.08)" />
      <circle cx={x(data.length - 1)} cy={py(last.close)} r="3.5" fill="hsl(var(--primary))" />
      <rect x={W - PR + 3} y={py(last.close) - 10} width={52} height={20} rx="5" fill="hsl(var(--primary))" fillOpacity="0.15" />
      <text x={W - PR + 11} y={py(last.close) + 4} fill="hsl(var(--primary))" fontSize="9.5" fontFamily="var(--app-font-mono)">{fmtCurrency(last.close)}</text>
    </svg>
  );
}

function movingAverage(vals: number[], w: number) {
  return vals.map((_, i) => {
    if (i < w - 1) return null;
    return vals.slice(i - w + 1, i + 1).reduce((s, v) => s + v, 0) / w;
  });
}

function emaSeries(vals: number[], w: number) {
  const k = 2 / (w + 1);
  let ema = vals[0] ?? 0;
  return vals.map((v, i) => {
    ema = i === 0 ? v : v * k + ema * (1 - k);
    return ema;
  });
}

function vwapSeries(data: PricePoint[]) {
  let pv = 0;
  let vol = 0;
  return data.map((d) => {
    const typical = (d.high + d.low + d.close) / 3;
    pv += typical * d.volume;
    vol += d.volume;
    return vol > 0 ? pv / vol : d.close;
  });
}

function stddev(vals: number[]) {
  if (vals.length === 0) return 0;
  const mean = vals.reduce((sum, value) => sum + value, 0) / vals.length;
  return Math.sqrt(vals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / vals.length);
}

function macdSeries(vals: number[]) {
  const ema12 = emaSeries(vals, Math.min(12, Math.max(2, vals.length)));
  const ema26 = emaSeries(vals, Math.min(26, Math.max(2, vals.length)));
  return vals.map((_, i) => (ema12[i] ?? 0) - (ema26[i] ?? 0));
}

function atrSeries(data: PricePoint[]) {
  return data.map((d, i) => {
    const prevClose = data[i - 1]?.close ?? d.close;
    return Math.max(d.high - d.low, Math.abs(d.high - prevClose), Math.abs(d.low - prevClose));
  });
}

function pathFor(vals: number[], y: (value: number) => number, x: (index: number) => number) {
  return vals.map((value, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
}

function pathForNullable(vals: Array<number | null>, y: (value: number) => number, x: (index: number) => number) {
  const first = vals.findIndex(value => value != null);
  if (first < 0) return "";
  return vals.map((value, i) => value == null ? null : `${i === first ? "M" : "L"} ${x(i).toFixed(1)} ${y(value).toFixed(1)}`).filter(Boolean).join(" ");
}

function rsiCalc(vals: number[]) {
  return vals.map((_, i) => {
    if (i === 0) return 50;
    const win = vals.slice(Math.max(1, i - 13), i + 1);
    let g = 0, l = 0;
    for (let j = 1; j < win.length; j++) { const c = win[j] - win[j - 1]; if (c >= 0) g += c; else l += Math.abs(c); }
    if (l === 0) return 70;
    return Math.max(10, Math.min(90, 100 - 100 / (1 + g / l)));
  });
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function StatCard({ label, value, valueColor }: { label: string; value: ReactNode; valueColor?: string }) {
  return (
    <div style={{
      padding: "12px 14px",
      borderRadius: 8,
      border: "1px solid rgba(255,255,255,0.06)",
      background: "rgba(255,255,255,0.02)",
      display: "flex",
      flexDirection: "column",
      gap: 5,
    }}>
      <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontWeight: 400, lineHeight: 1.2 }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em", color: valueColor ?? "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{value}</span>
    </div>
  );
}

function ActionBtn({ active, onClick, disabled, activeIcon, inactiveIcon, activeLabel, inactiveLabel, activeColor }: {
  active: boolean; onClick: () => void; disabled?: boolean;
  activeIcon: ReactNode; inactiveIcon: ReactNode;
  activeLabel: string; inactiveLabel: string; activeColor: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 5, padding: "4px 10px",
        borderRadius: 6, border: active ? `1px solid ${activeColor}40` : "1px solid rgba(255,255,255,0.10)",
        background: active ? `${activeColor}14` : "rgba(255,255,255,0.05)",
        color: active ? activeColor : "hsl(var(--muted-foreground))",
        fontSize: 11, fontWeight: 500, letterSpacing: "-0.01em",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
        transition: "all 0.15s", whiteSpace: "nowrap",
      }}
    >
      {active ? activeIcon : inactiveIcon}
      {active ? activeLabel : inactiveLabel}
    </button>
  );
}

function InfoCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      padding: "14px 16px",
      borderRadius: 8,
      border: "1px solid rgba(255,255,255,0.06)",
      background: "rgba(255,255,255,0.02)",
    }}>
      <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontWeight: 400, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "-0.01em", color: "hsl(var(--foreground))", lineHeight: 1.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{sub}</div>}
    </div>
  );
}

function EarningsInfoCard({ info }: { info: ReturnType<typeof getEarningsInfo> }) {
  const color =
    info.tone === "warn" ? "hsl(38 92% 50%)" :
    info.tone === "muted" ? "hsl(var(--muted-foreground))" :
    "hsl(var(--foreground))";

  return (
    <div style={{
      padding: "14px 16px",
      borderRadius: 8,
      border: info.tone === "warn" ? "1px solid hsl(38 92% 50% / 0.22)" : "1px solid rgba(255,255,255,0.06)",
      background: info.tone === "warn" ? "hsl(38 92% 50% / 0.07)" : "rgba(255,255,255,0.02)",
    }}>
      <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontWeight: 500, marginBottom: 5 }}>Earnings</div>
      <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em", color, lineHeight: 1.35 }}>{info.value}</div>
      <div style={{ fontSize: 12.5, color, marginTop: 4, fontWeight: 600 }}>{info.sub}</div>
      <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 5, fontVariantNumeric: "tabular-nums" }}>{info.detail}</div>
    </div>
  );
}
