import { useState, type ReactNode } from "react";
import { useGetStock, useGetStockPriceHistory, useGetWatchlist, useAddToWatchlist, useRemoveFromWatchlist, getGetWatchlistQueryKey } from "@workspace/api-client-react";
import { Activity, AlertCircle, BarChart2, CandlestickChart, Clock, LineChart, Star, TrendingDown, TrendingUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useToast } from "@/hooks/use-toast";
import type { PricePoint } from "@workspace/api-client-react";

interface StockDetailPanelProps {
  symbol: string;
}

export function StockDetailPanel({ symbol }: StockDetailPanelProps) {
  const [period, setPeriod] = useState<"1D" | "1W" | "1M" | "3M" | "6M" | "1Y">("3M");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: stock, isLoading: isLoadingStock } = useGetStock(symbol, { query: { enabled: !!symbol } });
  const { data: history = [], isLoading: isLoadingHistory } = useGetStockPriceHistory(symbol, { period }, { query: { enabled: !!symbol } });
  const { data: watchlist = [] } = useGetWatchlist();
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();

  const watchlistItem = watchlist.find((item) => item.symbol === symbol);
  const isWatched = !!watchlistItem;

  const handleWatchlistToggle = () => {
    if (isWatched && watchlistItem) {
      removeFromWatchlist.mutate(
        { id: watchlistItem.id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
            toast({ title: "Removed from watchlist", description: `${symbol} has been removed.` });
          },
        },
      );
    } else {
      addToWatchlist.mutate(
        { data: { symbol } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
            toast({ title: "Added to watchlist", description: `${symbol} has been added.` });
          },
        },
      );
    }
  };

  if (!symbol) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground p-8 text-center bg-background/50">
        <BarChart2 className="h-12 w-12 mb-4 opacity-20" />
        <p className="text-lg font-medium text-foreground">No symbol selected</p>
        <p className="text-sm mt-1">Select a stock from the ideas panel to view technical analysis and strategy context.</p>
      </div>
    );
  }

  if (isLoadingStock) {
    return (
      <div className="flex h-full flex-col p-6 gap-6 bg-background">
        <div className="flex justify-between items-start">
          <div>
            <Skeleton className="h-10 w-32 mb-2 bg-white/5" />
            <Skeleton className="h-4 w-48 bg-white/5" />
          </div>
          <div className="text-right">
            <Skeleton className="h-10 w-24 mb-2 ml-auto bg-white/5" />
            <Skeleton className="h-4 w-32 ml-auto bg-white/5" />
          </div>
        </div>
        <Skeleton className="h-[430px] w-full rounded-2xl bg-white/5" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  if (!stock) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground bg-background">
        <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
        <p>Failed to load stock data for {symbol}</p>
      </div>
    );
  }

  const isUp = stock.change >= 0;

  return (
    <div className="flex h-full flex-col bg-background overflow-hidden relative">
      <ScrollArea className="flex-1">
        <div className="flex flex-col p-6 md:p-8 gap-7 max-w-[1200px] mx-auto w-full relative z-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">{stock.symbol}</h1>
                <Badge variant="outline" className="font-medium text-xs bg-white/[0.055] border-white/[0.08] px-2.5 py-0.5 rounded-lg">{stock.sector}</Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleWatchlistToggle}
                  className={cn("h-9 w-9 rounded-full transition-all", isWatched ? "bg-primary/12 hover:bg-primary/20" : "hover:bg-white/10")}
                  disabled={addToWatchlist.isPending || removeFromWatchlist.isPending}
                >
                  <Star className={cn("h-4.5 w-4.5", isWatched ? "fill-primary text-primary" : "text-muted-foreground")} />
                </Button>
              </div>
              <p className="text-muted-foreground text-base mt-2 font-medium">{stock.name}</p>
            </div>

            <div className="text-left md:text-right">
              <div className="text-4xl md:text-5xl font-mono tracking-tight font-medium flex items-center md:justify-end gap-2">
                {formatCurrency(stock.price)}
              </div>
              <div className={cn("flex items-center md:justify-end gap-1.5 font-mono text-base font-medium mt-2", isUp ? "text-success" : "text-destructive")}>
                {isUp ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                {isUp ? "+" : ""}{formatCurrency(stock.change)} ({formatPercent(Math.abs(stock.changePercent))})
              </div>
            </div>
          </div>

          <div className="bg-card/40 backdrop-blur-xl rounded-[1.4rem] border border-white/[0.06] p-5 shadow-[0_16px_60px_rgba(0,0,0,0.28)] flex flex-col gap-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.055] text-primary">
                  <CandlestickChart className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-semibold text-base tracking-tight text-foreground/95">Technical Analysis</h3>
                  <p className="text-xs text-muted-foreground">Candles, volume, moving average, support and resistance</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden xl:flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />Bull candle</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />Bear candle</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" />MA</span>
                </div>
                <ToggleGroup type="single" value={period} onValueChange={(v) => v && setPeriod(v as any)} className="bg-black/35 border border-white/[0.06] rounded-xl p-1">
                  {["1D", "1W", "1M", "3M", "6M", "1Y"].map((item) => (
                    <ToggleGroupItem key={item} value={item} className="text-xs h-8 px-3 data-[state=on]:bg-white/12 data-[state=on]:text-foreground data-[state=on]:shadow-sm font-medium rounded-lg transition-all">
                      {item}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>

            <div className="h-[430px] w-full relative rounded-2xl border border-white/[0.045] bg-black/25 overflow-hidden">
              {isLoadingHistory ? (
                <div className="h-full w-full flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : (
                <TechnicalChart data={history} support={stock.supportPrice} resistance={stock.resistancePrice} isUp={isUp} />
              )}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SignalPill label="Trend" value={stock.priceAction.includes("bullish") ? "Bullish" : stock.priceAction.includes("bearish") ? "Bearish" : "Neutral"} tone={stock.priceAction.includes("bullish") ? "success" : stock.priceAction.includes("bearish") ? "destructive" : "primary"} />
              <SignalPill label="Support" value={formatCurrency(stock.supportPrice)} tone="success" />
              <SignalPill label="Resistance" value={formatCurrency(stock.resistancePrice)} tone="destructive" />
              <SignalPill label="IV Rank" value={`${stock.ivRank}%`} tone={stock.ivRank >= 40 ? "primary" : "neutral"} />
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Technical Strength" value={`${stock.technicalStrength} / 10`} valueColor={stock.technicalStrength >= 7 ? "text-success" : stock.technicalStrength <= 3 ? "text-destructive" : "text-primary"} />
            <StatCard label="Relative Strength" value={stock.relativeStrength} />
            <StatCard label="Market Cap" value={formatNumber(stock.marketCap)} />
            <StatCard label="Volume" value={formatNumber(stock.volume)} />
            <StatCard label="52W High" value={formatCurrency(stock.fiftyTwoWeekHigh)} />
            <StatCard label="52W Low" value={formatCurrency(stock.fiftyTwoWeekLow)} />
            <StatCard label="P/E Ratio" value={stock.pe.toFixed(2)} />
            <StatCard label="Dividend Yield" value={formatPercent(stock.dividendYield * 100)} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-8">
            <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/[0.06] p-5 shadow-sm flex items-start gap-4 hover:bg-card/60 transition-colors">
              <div className="bg-primary/10 p-2.5 rounded-xl mt-0.5 shrink-0">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Upcoming Earnings</h4>
                <p className="text-xl font-medium tracking-tight">{stock.earningsDate}</p>
                <p className="text-sm text-muted-foreground mt-1">Expected EPS: <span className="font-mono text-foreground">{stock.eps.toFixed(2)}</span></p>
              </div>
            </div>

            <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/[0.06] p-5 shadow-sm flex items-start gap-4 hover:bg-card/60 transition-colors">
              <div className="bg-white/5 p-2.5 rounded-xl mt-0.5 shrink-0">
                <Activity className="h-5 w-5 text-foreground/70" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Price Action</h4>
                <p className="text-sm leading-relaxed text-foreground/90">{stock.priceAction}</p>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function TechnicalChart({ data, support, resistance, isUp }: { data: PricePoint[]; support: number; resistance: number; isUp: boolean }) {
  const width = 900;
  const height = 430;
  const priceTop = 28;
  const priceHeight = 250;
  const volumeTop = 292;
  const volumeHeight = 58;
  const rsiTop = 368;
  const rsiHeight = 38;
  const leftPad = 18;
  const rightPad = 58;
  const chartWidth = width - leftPad - rightPad;

  if (!data.length) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No chart data available.</div>;
  }

  const lows = data.map((point) => point.low);
  const highs = data.map((point) => point.high);
  const priceMin = Math.min(...lows, support) * 0.985;
  const priceMax = Math.max(...highs, resistance) * 1.015;
  const maxVolume = Math.max(...data.map((point) => point.volume), 1);
  const candleWidth = Math.max(3, Math.min(12, chartWidth / data.length * 0.56));
  const xStep = chartWidth / Math.max(data.length - 1, 1);
  const ma = movingAverage(data.map((point) => point.close), Math.min(12, Math.max(4, Math.floor(data.length / 8))));
  const rsi = relativeStrengthIndex(data.map((point) => point.close));

  const x = (index: number) => leftPad + index * xStep;
  const priceY = (price: number) => priceTop + (priceMax - price) / (priceMax - priceMin || 1) * priceHeight;
  const volumeY = (volume: number) => volumeTop + volumeHeight - (volume / maxVolume) * volumeHeight;
  const rsiY = (value: number) => rsiTop + (100 - value) / 100 * rsiHeight;
  const supportY = priceY(support);
  const resistanceY = priceY(resistance);
  const current = data[data.length - 1];

  const maPath = ma
    .map((value, index) => (value == null ? null : `${index === ma.findIndex((item) => item != null) ? "M" : "L"} ${x(index).toFixed(2)} ${priceY(value).toFixed(2)}`))
    .filter(Boolean)
    .join(" ");

  const rsiPath = rsi
    .map((value, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(2)} ${rsiY(value).toFixed(2)}`)
    .join(" ");

  const gridPrices = [priceMin, priceMin + (priceMax - priceMin) * 0.25, priceMin + (priceMax - priceMin) * 0.5, priceMin + (priceMax - priceMin) * 0.75, priceMax];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" preserveAspectRatio="none" role="img" aria-label="Technical analysis chart">
      <defs>
        <linearGradient id="chartFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={isUp ? "hsl(var(--success))" : "hsl(var(--destructive))"} stopOpacity="0.14" />
          <stop offset="100%" stopColor="transparent" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width={width} height={height} fill="rgba(255,255,255,0.012)" />
      {gridPrices.map((price) => (
        <g key={price}>
          <line x1={leftPad} x2={width - rightPad} y1={priceY(price)} y2={priceY(price)} stroke="rgba(255,255,255,0.06)" strokeDasharray="4 7" />
          <text x={width - rightPad + 10} y={priceY(price) + 4} fill="rgba(255,255,255,0.42)" fontSize="10" fontFamily="var(--app-font-mono)">{formatCurrency(price)}</text>
        </g>
      ))}

      <line x1={leftPad} x2={width - rightPad} y1={supportY} y2={supportY} stroke="hsl(var(--success))" strokeOpacity="0.55" strokeDasharray="7 7" />
      <text x={leftPad + 6} y={supportY - 6} fill="hsl(var(--success))" fontSize="10" fontFamily="var(--app-font-mono)">Support {formatCurrency(support)}</text>
      <line x1={leftPad} x2={width - rightPad} y1={resistanceY} y2={resistanceY} stroke="hsl(var(--destructive))" strokeOpacity="0.55" strokeDasharray="7 7" />
      <text x={leftPad + 6} y={resistanceY - 6} fill="hsl(var(--destructive))" fontSize="10" fontFamily="var(--app-font-mono)">Resistance {formatCurrency(resistance)}</text>

      {maPath && (
        <path d={`${maPath} L ${x(data.length - 1)} ${priceTop + priceHeight} L ${x(ma.findIndex((item) => item != null))} ${priceTop + priceHeight} Z`} fill="url(#chartFade)" opacity="0.6" />
      )}

      {data.map((point, index) => {
        const bullish = point.close >= point.open;
        const cx = x(index);
        const openY = priceY(point.open);
        const closeY = priceY(point.close);
        const highY = priceY(point.high);
        const lowY = priceY(point.low);
        const bodyY = Math.min(openY, closeY);
        const bodyHeight = Math.max(2, Math.abs(openY - closeY));
        const color = bullish ? "hsl(var(--success))" : "hsl(var(--destructive))";
        return (
          <g key={`${point.date}-${index}`} opacity={index < data.length - 26 ? 0.72 : 1}>
            <line x1={cx} x2={cx} y1={highY} y2={lowY} stroke={color} strokeWidth="1.15" strokeOpacity="0.82" />
            <rect x={cx - candleWidth / 2} y={bodyY} width={candleWidth} height={bodyHeight} rx="1.4" fill={color} fillOpacity={bullish ? 0.78 : 0.82} />
            <rect x={cx - candleWidth / 2} y={volumeY(point.volume)} width={candleWidth} height={volumeTop + volumeHeight - volumeY(point.volume)} rx="1.2" fill={color} fillOpacity="0.22" />
          </g>
        );
      })}

      {maPath && <path d={maPath} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.88" />}

      <line x1={leftPad} x2={width - rightPad} y1={volumeTop} y2={volumeTop} stroke="rgba(255,255,255,0.08)" />
      <text x={leftPad} y={volumeTop - 8} fill="rgba(255,255,255,0.45)" fontSize="10" fontFamily="var(--app-font-sans)">Volume</text>

      <rect x={leftPad} y={rsiTop} width={chartWidth} height={rsiHeight} rx="8" fill="rgba(255,255,255,0.025)" />
      <line x1={leftPad} x2={width - rightPad} y1={rsiY(70)} y2={rsiY(70)} stroke="hsl(var(--destructive))" strokeOpacity="0.28" strokeDasharray="5 6" />
      <line x1={leftPad} x2={width - rightPad} y1={rsiY(30)} y2={rsiY(30)} stroke="hsl(var(--success))" strokeOpacity="0.28" strokeDasharray="5 6" />
      <path d={rsiPath} fill="none" stroke="hsl(var(--chart-2))" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" opacity="0.88" />
      <text x={leftPad} y={rsiTop - 8} fill="rgba(255,255,255,0.45)" fontSize="10" fontFamily="var(--app-font-sans)">RSI</text>

      <g>
        <line x1={x(data.length - 1)} x2={x(data.length - 1)} y1={priceTop} y2={rsiTop + rsiHeight} stroke="rgba(255,255,255,0.10)" />
        <circle cx={x(data.length - 1)} cy={priceY(current.close)} r="4" fill="hsl(var(--primary))" />
        <rect x={width - rightPad + 4} y={priceY(current.close) - 11} width="50" height="22" rx="7" fill="hsl(var(--primary))" fillOpacity="0.16" stroke="hsl(var(--primary))" strokeOpacity="0.25" />
        <text x={width - rightPad + 12} y={priceY(current.close) + 4} fill="hsl(var(--primary))" fontSize="10" fontFamily="var(--app-font-mono)">{formatCurrency(current.close)}</text>
      </g>
    </svg>
  );
}

function movingAverage(values: number[], windowSize: number) {
  return values.map((_, index) => {
    if (index < windowSize - 1) return null;
    const window = values.slice(index - windowSize + 1, index + 1);
    return window.reduce((sum, value) => sum + value, 0) / window.length;
  });
}

function relativeStrengthIndex(values: number[]) {
  return values.map((value, index) => {
    if (index === 0) return 50;
    const start = Math.max(1, index - 13);
    const window = values.slice(start, index + 1);
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < window.length; i += 1) {
      const change = window[i] - window[i - 1];
      if (change >= 0) gains += change;
      else losses += Math.abs(change);
    }
    if (losses === 0) return 70;
    const rs = gains / losses;
    return Math.max(10, Math.min(90, 100 - 100 / (1 + rs)));
  });
}

function SignalPill({ label, value, tone }: { label: string; value: string; tone: "success" | "destructive" | "primary" | "neutral" }) {
  return (
    <div className="rounded-2xl border border-white/[0.055] bg-white/[0.03] px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 font-mono text-sm",
          tone === "success" && "text-success",
          tone === "destructive" && "text-destructive",
          tone === "primary" && "text-primary",
          tone === "neutral" && "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StatCard({ label, value, valueColor = "text-foreground" }: { label: string; value: ReactNode; valueColor?: string }) {
  return (
    <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/[0.06] p-4 flex flex-col justify-center gap-1.5 hover:bg-white/5 transition-all duration-300">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider truncate">{label}</span>
      <span className={cn("text-xl font-mono font-medium tracking-tight truncate", valueColor)}>{value}</span>
    </div>
  );
}
