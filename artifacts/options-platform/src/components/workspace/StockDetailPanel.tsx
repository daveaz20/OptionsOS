import { useState } from "react";
import { useGetStock, useGetStockPriceHistory, useGetWatchlist, useAddToWatchlist, useRemoveFromWatchlist, getGetWatchlistQueryKey } from "@workspace/api-client-react";
import { Star, TrendingUp, TrendingDown, Clock, Activity, BarChart2, AlertCircle } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useToast } from "@/hooks/use-toast";

interface StockDetailPanelProps {
  symbol: string;
}

export function StockDetailPanel({ symbol }: StockDetailPanelProps) {
  const [period, setPeriod] = useState<"1D" | "1W" | "1M" | "3M" | "6M" | "1Y">("1M");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: stock, isLoading: isLoadingStock } = useGetStock(symbol, { query: { enabled: !!symbol } });
  const { data: history = [], isLoading: isLoadingHistory } = useGetStockPriceHistory(symbol, { period }, { query: { enabled: !!symbol } });
  const { data: watchlist = [] } = useGetWatchlist();
  
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();

  const watchlistItem = watchlist.find(w => w.symbol === symbol);
  const isWatched = !!watchlistItem;

  const handleWatchlistToggle = () => {
    if (isWatched && watchlistItem) {
      removeFromWatchlist.mutate({ id: watchlistItem.id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
          toast({ title: "Removed from watchlist", description: `${symbol} has been removed.` });
        }
      });
    } else {
      addToWatchlist.mutate({ data: { symbol } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
          toast({ title: "Added to watchlist", description: `${symbol} has been added.` });
        }
      });
    }
  };

  if (!symbol) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground p-8 text-center bg-background/50">
        <BarChart2 className="h-12 w-12 mb-4 opacity-20" />
        <p className="text-lg font-medium text-foreground">No symbol selected</p>
        <p className="text-sm mt-1">Select a stock from the list to view details and options strategies.</p>
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
        <Skeleton className="h-[300px] w-full rounded-2xl bg-white/5" />
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
  const minPrice = history.length ? Math.min(...history.map(d => d.close)) : 0;
  const maxPrice = history.length ? Math.max(...history.map(d => d.close)) : 0;
  const priceBuffer = (maxPrice - minPrice) * 0.1;

  return (
    <div className="flex h-full flex-col bg-background overflow-hidden relative">
      <ScrollArea className="flex-1">
        <div className="flex flex-col p-6 md:p-8 gap-8 max-w-[1200px] mx-auto w-full relative z-10">
          
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">{stock.symbol}</h1>
                <Badge variant="outline" className="font-medium text-xs bg-white/5 border-white/10 px-2.5 py-0.5 rounded-md">{stock.sector}</Badge>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={handleWatchlistToggle}
                  className={cn("h-9 w-9 rounded-full transition-all", isWatched ? "bg-primary/10 hover:bg-primary/20" : "hover:bg-white/10")}
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

          {/* Chart Section */}
          <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/5 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] flex flex-col gap-6">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-sm flex items-center gap-2 text-foreground/80">
                <Activity className="h-4 w-4" />
                Price Action
              </h3>
              <ToggleGroup type="single" value={period} onValueChange={(v) => v && setPeriod(v as any)} className="bg-black/40 border border-white/5 rounded-lg p-1">
                {["1D", "1W", "1M", "3M", "6M", "1Y"].map((p) => (
                  <ToggleGroupItem key={p} value={p} className="text-xs h-7 px-3.5 data-[state=on]:bg-white/10 data-[state=on]:text-foreground data-[state=on]:shadow-sm font-medium rounded-md transition-all">
                    {p}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            
            <div className="h-[320px] w-full relative">
              {isLoadingHistory ? (
                <div className="h-full w-full flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={isUp ? "hsl(var(--success))" : "hsl(var(--destructive))"} stopOpacity={0.2}/>
                        <stop offset="95%" stopColor={isUp ? "hsl(var(--success))" : "hsl(var(--destructive))"} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="date" 
                      hide
                    />
                    <YAxis 
                      domain={[minPrice - priceBuffer, maxPrice + priceBuffer]} 
                      hide
                    />
                    <Tooltip
                      cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 4' }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-card/80 backdrop-blur-xl border border-white/10 p-4 rounded-xl shadow-2xl font-medium text-sm min-w-[180px]">
                              <div className="text-muted-foreground text-xs mb-2">{data.date}</div>
                              <div className="text-foreground font-mono text-xl tracking-tight mb-3">{formatCurrency(data.close)}</div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                                <div className="flex flex-col"><span className="text-muted-foreground/70 uppercase text-[10px]">Open</span><span className="font-mono">{formatCurrency(data.open)}</span></div>
                                <div className="flex flex-col"><span className="text-muted-foreground/70 uppercase text-[10px]">High</span><span className="font-mono">{formatCurrency(data.high)}</span></div>
                                <div className="flex flex-col"><span className="text-muted-foreground/70 uppercase text-[10px]">Low</span><span className="font-mono">{formatCurrency(data.low)}</span></div>
                                <div className="flex flex-col"><span className="text-muted-foreground/70 uppercase text-[10px]">Vol</span><span className="font-mono">{formatNumber(data.volume)}</span></div>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <ReferenceLine y={history[0]?.open || 0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.3} />
                    <Area 
                      type="monotone" 
                      dataKey="close" 
                      stroke={isUp ? "hsl(var(--success))" : "hsl(var(--destructive))"} 
                      strokeWidth={2.5}
                      fillOpacity={1} 
                      fill="url(#colorPrice)" 
                      animationDuration={1000}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Technical Strength" value={`${stock.technicalStrength} / 10`} valueColor={stock.technicalStrength >= 7 ? "text-success" : stock.technicalStrength <= 3 ? "text-destructive" : "text-primary"} />
            <StatCard label="IV Rank" value={`${stock.ivRank}%`} />
            <StatCard label="Market Cap" value={formatNumber(stock.marketCap)} />
            <StatCard label="Volume" value={formatNumber(stock.volume)} />
            
            <StatCard label="52W High" value={formatCurrency(stock.fiftyTwoWeekHigh)} />
            <StatCard label="52W Low" value={formatCurrency(stock.fiftyTwoWeekLow)} />
            <StatCard label="P/E Ratio" value={stock.pe.toFixed(2)} />
            <StatCard label="Dividend Yield" value={formatPercent(stock.dividendYield * 100)} />

            <StatCard label="Support" value={formatCurrency(stock.supportPrice)} />
            <StatCard label="Resistance" value={formatCurrency(stock.resistancePrice)} />
            <StatCard label="Relative Strength" value={stock.relativeStrength} />
            <StatCard label="Liquidity" value={stock.liquidity} />
          </div>

          {/* Additional Context */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-8">
            <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/5 p-5 shadow-sm flex items-start gap-4 hover:bg-card/60 transition-colors">
              <div className="bg-primary/10 p-2.5 rounded-xl mt-0.5 shrink-0">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Upcoming Earnings</h4>
                <p className="text-xl font-medium tracking-tight">{stock.earningsDate}</p>
                <p className="text-sm text-muted-foreground mt-1">Expected EPS: <span className="font-mono text-foreground">{stock.eps.toFixed(2)}</span></p>
              </div>
            </div>
            
            <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/5 p-5 shadow-sm flex items-start gap-4 hover:bg-card/60 transition-colors">
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

function StatCard({ label, value, valueColor = "text-foreground" }: { label: string, value: React.ReactNode, valueColor?: string }) {
  return (
    <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/5 p-4 flex flex-col justify-center gap-1.5 hover:bg-white/5 transition-all duration-300">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider truncate">{label}</span>
      <span className={cn("text-xl font-mono font-medium tracking-tight truncate", valueColor)}>{value}</span>
    </div>
  );
}
