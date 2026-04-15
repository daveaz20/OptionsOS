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
            <Skeleton className="h-10 w-32 mb-2" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="text-right">
            <Skeleton className="h-10 w-24 mb-2 ml-auto" />
            <Skeleton className="h-4 w-32 ml-auto" />
          </div>
        </div>
        <Skeleton className="h-[300px] w-full" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
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
    <div className="flex h-full flex-col bg-background overflow-hidden">
      <ScrollArea className="flex-1">
        <div className="flex flex-col p-4 md:p-6 gap-6 max-w-5xl mx-auto w-full">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl md:text-4xl font-bold font-mono tracking-tight">{stock.symbol}</h1>
                <Badge variant="outline" className="font-mono bg-card">{stock.sector}</Badge>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={handleWatchlistToggle}
                  className={cn("h-8 w-8 rounded-full", isWatched && "bg-primary/10 hover:bg-primary/20")}
                  disabled={addToWatchlist.isPending || removeFromWatchlist.isPending}
                >
                  <Star className={cn("h-4 w-4", isWatched ? "fill-primary text-primary" : "text-muted-foreground")} />
                </Button>
              </div>
              <p className="text-muted-foreground text-sm mt-1">{stock.name}</p>
            </div>

            <div className="text-right">
              <div className="text-3xl md:text-4xl font-bold font-mono tracking-tight flex items-center justify-end gap-2">
                {formatCurrency(stock.price)}
              </div>
              <div className={cn("flex items-center justify-end gap-1.5 font-mono text-sm font-medium mt-1", isUp ? "text-success" : "text-destructive")}>
                {isUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                {isUp ? "+" : ""}{formatCurrency(stock.change)} ({formatPercent(stock.changePercent)})
              </div>
            </div>
          </div>

          {/* Chart Section */}
          <div className="bg-card rounded-xl border border-border p-4 shadow-sm flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h3 className="font-medium text-sm flex items-center gap-2 text-muted-foreground">
                <Activity className="h-4 w-4" />
                Price Action
              </h3>
              <ToggleGroup type="single" value={period} onValueChange={(v) => v && setPeriod(v as any)} className="bg-background/50 border border-border rounded-md p-0.5">
                {["1D", "1W", "1M", "3M", "6M", "1Y"].map((p) => (
                  <ToggleGroupItem key={p} value={p} className="text-xs h-7 px-3 data-[state=on]:bg-primary/10 data-[state=on]:text-primary font-mono rounded-sm">
                    {p}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            
            <div className="h-[280px] w-full">
              {isLoadingHistory ? (
                <div className="h-full w-full flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={isUp ? "hsl(var(--success))" : "hsl(var(--destructive))"} stopOpacity={0.3}/>
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
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-card border border-border p-3 rounded-lg shadow-xl font-mono text-sm">
                              <div className="text-muted-foreground mb-1">{data.date}</div>
                              <div className="text-foreground font-bold text-lg">{formatCurrency(data.close)}</div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
                                <span className="text-muted-foreground">O: {formatCurrency(data.open)}</span>
                                <span className="text-muted-foreground">H: {formatCurrency(data.high)}</span>
                                <span className="text-muted-foreground">L: {formatCurrency(data.low)}</span>
                                <span className="text-muted-foreground">V: {formatNumber(data.volume)}</span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <ReferenceLine y={history[0]?.open || 0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
                    <Area 
                      type="monotone" 
                      dataKey="close" 
                      stroke={isUp ? "hsl(var(--success))" : "hsl(var(--destructive))"} 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorPrice)" 
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

            <StatCard label="Support" value={formatCurrency(stock.supportPrice)} valueColor="text-success" />
            <StatCard label="Resistance" value={formatCurrency(stock.resistancePrice)} valueColor="text-destructive" />
            <StatCard label="Relative Strength" value={stock.relativeStrength} />
            <StatCard label="Liquidity" value={stock.liquidity} />
          </div>

          {/* Additional Context */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card rounded-xl border border-border p-4 shadow-sm flex items-start gap-4">
              <div className="bg-primary/10 p-2 rounded-full mt-1 shrink-0">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Upcoming Earnings</h4>
                <p className="text-lg font-mono">{stock.earningsDate}</p>
                <p className="text-xs text-muted-foreground mt-1">Expected EPS: {stock.eps.toFixed(2)}</p>
              </div>
            </div>
            
            <div className="bg-card rounded-xl border border-border p-4 shadow-sm flex items-start gap-4">
              <div className="bg-accent p-2 rounded-full mt-1 shrink-0">
                <Activity className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Price Action</h4>
                <p className="text-sm leading-relaxed">{stock.priceAction}</p>
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
    <div className="bg-card rounded-xl border border-border p-4 flex flex-col gap-1 hover:border-primary/30 transition-colors">
      <span className="text-xs font-medium text-muted-foreground truncate">{label}</span>
      <span className={cn("text-lg font-mono font-medium tracking-tight truncate", valueColor)}>{value}</span>
    </div>
  );
}
