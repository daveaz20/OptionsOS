import { useState, type ReactNode } from "react";
import { useGetStock, useGetStockPriceHistory, useGetWatchlist, useAddToWatchlist, useRemoveFromWatchlist, getGetWatchlistQueryKey } from "@workspace/api-client-react";
import { AlertCircle, BarChart2, Star, TrendingDown, TrendingUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import type { PricePoint } from "@workspace/api-client-react";

interface StockDetailPanelProps {
  symbol: string;
}

const PERIODS = ["1D", "1W", "1M", "3M", "6M", "1Y"] as const;
type Period = (typeof PERIODS)[number];

export function StockDetailPanel({ symbol }: StockDetailPanelProps) {
  const [period, setPeriod] = useState<Period>("3M");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: stock, isLoading: isLoadingStock } = useGetStock(symbol, { query: { enabled: !!symbol } });
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
          toast({ title: `Removed ${symbol}`, description: "Removed from watchlist." });
        },
      });
    } else {
      addToWatchlist.mutate({ data: { symbol } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
          toast({ title: `Added ${symbol}`, description: "Added to watchlist." });
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

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "hsl(var(--background))" }}>
      <ScrollArea className="flex-1">
        <div style={{ padding: "28px 32px 40px", maxWidth: 1100, margin: "0 auto", width: "100%" }}>

          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
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
                <button
                  onClick={handleWatchlistToggle}
                  disabled={addToWatchlist.isPending || removeFromWatchlist.isPending}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    border: "none",
                    background: isWatched ? "hsl(var(--primary) / 0.1)" : "rgba(255,255,255,0.05)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <Star style={{ width: 13, height: 13, fill: isWatched ? "hsl(var(--primary))" : "none", color: isWatched ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))", stroke: "currentColor", strokeWidth: 2 }} />
                </button>
              </div>
              <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", fontWeight: 400 }}>{stock.name}</p>
            </div>

            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
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
            <div style={{ height: 400, position: "relative" }}>
              {isLoadingHistory ? (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid transparent", borderBottomColor: "hsl(var(--primary))", animation: "spin 0.8s linear infinite" }} />
                </div>
              ) : (
                <TechnicalChart data={history} support={stock.supportPrice} resistance={stock.resistancePrice} isUp={isUp} />
              )}
            </div>

            {/* Signal strip */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              {[
                { label: "Trend", value: stock.priceAction.includes("bullish") ? "Bullish" : stock.priceAction.includes("bearish") ? "Bearish" : "Neutral", color: stock.priceAction.includes("bullish") ? "hsl(var(--success))" : stock.priceAction.includes("bearish") ? "hsl(var(--destructive))" : "hsl(var(--primary))" },
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
            <InfoCard label="Earnings Date" value={stock.earningsDate} sub={`Expected EPS: ${stock.eps.toFixed(2)}`} />
            <InfoCard label="Price Action" value={stock.priceAction} />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function TechnicalChart({ data, support, resistance, isUp }: { data: PricePoint[]; support: number; resistance: number; isUp: boolean }) {
  const W = 900;
  const H = 400;
  const PT = 24, PH = 218;
  const VT = 258, VH = 54;
  const RT = 326, RH = 46;
  const PL = 14, PR = 58;
  const CW = W - PL - PR;

  if (!data.length) return <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "hsl(var(--muted-foreground))" }}>No data</div>;

  const lows = data.map((d) => d.low);
  const highs = data.map((d) => d.high);
  const pMin = Math.min(...lows, support) * 0.984;
  const pMax = Math.max(...highs, resistance) * 1.016;
  const maxVol = Math.max(...data.map((d) => d.volume), 1);
  const cw = Math.max(2, Math.min(11, (CW / data.length) * 0.55));
  const xStep = CW / Math.max(data.length - 1, 1);
  const maWin = Math.min(12, Math.max(4, Math.floor(data.length / 8)));
  const ma = movingAverage(data.map((d) => d.close), maWin);
  const rsi = rsiCalc(data.map((d) => d.close));

  const x = (i: number) => PL + i * xStep;
  const py = (p: number) => PT + ((pMax - p) / (pMax - pMin || 1)) * PH;
  const vy = (v: number) => VT + VH - (v / maxVol) * VH;
  const ry = (r: number) => RT + ((100 - r) / 100) * RH;

  const sy = py(support);
  const ry2 = py(resistance);
  const last = data[data.length - 1];

  const maPath = ma.map((v, i) => v == null ? null : `${i === ma.findIndex((m) => m != null) ? "M" : "L"} ${x(i).toFixed(1)} ${py(v).toFixed(1)}`).filter(Boolean).join(" ");
  const rsiPath = rsi.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${ry(v).toFixed(1)}`).join(" ");

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
          <text x={W - PR + 8} y={py(p) + 4} fill="rgba(255,255,255,0.35)" fontSize="9.5" fontFamily="var(--app-font-mono)">{formatCurrency(p)}</text>
        </g>
      ))}

      {/* Support / Resistance */}
      <line x1={PL} x2={W - PR} y1={sy} y2={sy} stroke="hsl(var(--success))" strokeOpacity="0.5" strokeDasharray="6 6" />
      <text x={PL + 4} y={sy - 5} fill="hsl(var(--success))" fillOpacity="0.8" fontSize="9" fontFamily="var(--app-font-mono)">S {formatCurrency(support)}</text>
      <line x1={PL} x2={W - PR} y1={ry2} y2={ry2} stroke="hsl(var(--destructive))" strokeOpacity="0.5" strokeDasharray="6 6" />
      <text x={PL + 4} y={ry2 - 5} fill="hsl(var(--destructive))" fillOpacity="0.8" fontSize="9" fontFamily="var(--app-font-mono)">R {formatCurrency(resistance)}</text>

      {/* MA gradient fill */}
      {maPath && (
        <path
          d={`${maPath} L ${x(data.length - 1)} ${PT + PH} L ${x(ma.findIndex((m) => m != null))} ${PT + PH} Z`}
          fill="url(#maGrad)"
        />
      )}

      {/* Candles */}
      {data.map((d, i) => {
        const bull = d.close >= d.open;
        const cx = x(i);
        const oy = py(d.open), cy2 = py(d.close), hy = py(d.high), ly = py(d.low);
        const by = Math.min(oy, cy2);
        const bh = Math.max(1.5, Math.abs(oy - cy2));
        const col = bull ? "hsl(var(--success))" : "hsl(var(--destructive))";
        return (
          <g key={i} opacity={0.9}>
            <line x1={cx} x2={cx} y1={hy} y2={ly} stroke={col} strokeWidth="1" strokeOpacity="0.7" />
            <rect x={cx - cw / 2} y={by} width={cw} height={bh} rx="1" fill={col} fillOpacity={bull ? 0.75 : 0.8} />
            <rect x={cx - cw / 2} y={vy(d.volume)} width={cw} height={VT + VH - vy(d.volume)} fill={col} fillOpacity="0.18" />
          </g>
        );
      })}

      {/* MA line */}
      {maPath && <path d={maPath} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />}

      {/* Volume label */}
      <line x1={PL} x2={W - PR} y1={VT} y2={VT} stroke="rgba(255,255,255,0.06)" />
      <text x={PL} y={VT - 5} fill="rgba(255,255,255,0.3)" fontSize="8.5" fontFamily="var(--app-font-sans)">Vol</text>

      {/* RSI */}
      <rect x={PL} y={RT} width={CW} height={RH} fill="rgba(255,255,255,0.018)" rx="3" />
      <line x1={PL} x2={W - PR} y1={ry(70)} y2={ry(70)} stroke="hsl(var(--destructive))" strokeOpacity="0.22" strokeDasharray="4 5" />
      <line x1={PL} x2={W - PR} y1={ry(30)} y2={ry(30)} stroke="hsl(var(--success))" strokeOpacity="0.22" strokeDasharray="4 5" />
      <path d={rsiPath} fill="none" stroke="hsl(262 80% 65%)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      <text x={PL} y={RT - 5} fill="rgba(255,255,255,0.3)" fontSize="8.5" fontFamily="var(--app-font-sans)">RSI</text>

      {/* Current price marker */}
      <line x1={x(data.length - 1)} x2={x(data.length - 1)} y1={PT} y2={RT + RH} stroke="rgba(255,255,255,0.08)" />
      <circle cx={x(data.length - 1)} cy={py(last.close)} r="3.5" fill="hsl(var(--primary))" />
      <rect x={W - PR + 3} y={py(last.close) - 10} width={52} height={20} rx="5" fill="hsl(var(--primary))" fillOpacity="0.15" />
      <text x={W - PR + 11} y={py(last.close) + 4} fill="hsl(var(--primary))" fontSize="9.5" fontFamily="var(--app-font-mono)">{formatCurrency(last.close)}</text>
    </svg>
  );
}

function movingAverage(vals: number[], w: number) {
  return vals.map((_, i) => {
    if (i < w - 1) return null;
    return vals.slice(i - w + 1, i + 1).reduce((s, v) => s + v, 0) / w;
  });
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
