import { useGetDashboardSummary, useGetTopMovers, useGetWatchlist, getGetWatchlistQueryKey, useRemoveFromWatchlist } from "@workspace/api-client-react";
import { BarChart2, TrendingUp, TrendingDown, Activity, Star, ArrowUpRight, ArrowDownRight, AlertCircle, LayoutDashboard } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { Stock } from "@workspace/api-client-react";

export default function DashboardPage() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: topMovers, isLoading: isLoadingMovers } = useGetTopMovers();
  const { data: watchlist = [], isLoading: isLoadingWatchlist } = useGetWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleRemoveWatchlist = (id: number, symbol: string) => {
    removeFromWatchlist.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        toast({ title: "Removed from watchlist", description: `${symbol} has been removed.` });
      }
    });
  };

  return (
    <ScrollArea className="h-full w-full bg-background/50">
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <LayoutDashboard className="h-8 w-8 text-primary" />
            Market Overview
          </h1>
          <p className="text-muted-foreground mt-2">Comprehensive snapshot of market conditions and your watchlisted assets.</p>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Market Sentiment"
            value={isLoadingSummary ? <Skeleton className="h-8 w-24" /> : <span className="capitalize">{summary?.marketSentiment}</span>}
            icon={<Activity className="h-4 w-4 text-muted-foreground" />}
            valueColor={
              summary?.marketSentiment === "bullish" ? "text-success" : 
              summary?.marketSentiment === "bearish" ? "text-destructive" : 
              "text-primary"
            }
            description={!isLoadingSummary && `Based on ${summary?.totalStocks} stocks`}
          />
          <StatCard
            title="Total Tracked Stocks"
            value={isLoadingSummary ? <Skeleton className="h-8 w-16" /> : summary?.totalStocks.toString()}
            icon={<BarChart2 className="h-4 w-4 text-muted-foreground" />}
          />
          <StatCard
            title="Avg Tech Strength"
            value={isLoadingSummary ? <Skeleton className="h-8 w-16" /> : `${summary?.avgTechnicalStrength.toFixed(1)} / 10`}
            icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
            description="Overall market technicals"
          />
          <StatCard
            title="Market Breadth"
            value={isLoadingSummary ? <Skeleton className="h-8 w-32" /> : (
              <div className="flex items-center gap-3 text-base">
                <span className="text-success flex items-center"><TrendingUp className="h-4 w-4 mr-1" /> {summary?.bullishCount}</span>
                <span className="text-muted-foreground">- {summary?.neutralCount} -</span>
                <span className="text-destructive flex items-center"><TrendingDown className="h-4 w-4 mr-1" /> {summary?.bearishCount}</span>
              </div>
            )}
            icon={<Activity className="h-4 w-4 text-muted-foreground" />}
            description="Bullish / Neutral / Bearish"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Top Movers Section */}
          <div className="col-span-1 lg:col-span-2 space-y-6">
            <Card className="bg-card border-border shadow-sm">
              <CardHeader className="pb-3 border-b border-border/50">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-success" />
                  Top Gainers
                </CardTitle>
                <CardDescription>Stocks with the highest percentage gains today.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {isLoadingMovers ? (
                  <div className="p-4 space-y-3">
                    {Array.from({length: 3}).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : topMovers?.gainers.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">No gainers available.</div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {topMovers?.gainers.map((stock) => (
                      <MoverRow key={stock.id} stock={stock} type="gainer" />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-border shadow-sm">
              <CardHeader className="pb-3 border-b border-border/50">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-destructive" />
                  Top Losers
                </CardTitle>
                <CardDescription>Stocks with the highest percentage losses today.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {isLoadingMovers ? (
                  <div className="p-4 space-y-3">
                    {Array.from({length: 3}).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : topMovers?.losers.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">No losers available.</div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {topMovers?.losers.map((stock) => (
                      <MoverRow key={stock.id} stock={stock} type="loser" />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Watchlist Quick View */}
          <div className="col-span-1 space-y-6">
            <Card className="bg-card border-border shadow-sm h-full flex flex-col">
              <CardHeader className="pb-3 border-b border-border/50 shrink-0">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Star className="h-5 w-5 fill-primary text-primary" />
                  Your Watchlist
                </CardTitle>
                <CardDescription>Tracked assets and their performance.</CardDescription>
              </CardHeader>
              <CardContent className="p-0 flex-1 overflow-hidden">
                <ScrollArea className="h-[500px]">
                  {isLoadingWatchlist ? (
                    <div className="p-4 space-y-3">
                      {Array.from({length: 5}).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                    </div>
                  ) : watchlist.length === 0 ? (
                    <div className="p-12 flex flex-col items-center justify-center text-center gap-3">
                      <Star className="h-12 w-12 text-muted-foreground opacity-20" />
                      <p className="text-muted-foreground text-sm">Your watchlist is empty.</p>
                      <Button asChild variant="outline" size="sm" className="mt-2">
                        <Link href="/">Go to Workspace</Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {watchlist.map((item) => {
                        const isUp = item.change >= 0;
                        return (
                          <div key={item.id} className="p-4 flex flex-col gap-2 hover:bg-accent/30 transition-colors group">
                            <div className="flex justify-between items-start">
                              <div>
                                <Link href="/" className="font-bold font-mono text-foreground hover:text-primary transition-colors">
                                  {item.symbol}
                                </Link>
                                <p className="text-xs text-muted-foreground truncate max-w-[120px] mt-0.5">{item.name}</p>
                              </div>
                              <div className="text-right">
                                <div className="font-mono font-medium">{formatCurrency(item.price)}</div>
                                <div className={cn("text-xs font-mono flex items-center justify-end gap-1 mt-0.5", isUp ? "text-success" : "text-destructive")}>
                                  {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                  {formatPercent(item.changePercent)}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between mt-2">
                              <Badge variant="outline" className={cn("text-[10px] font-mono", item.technicalStrength >= 7 ? "text-success border-success/30" : item.technicalStrength <= 3 ? "text-destructive border-destructive/30" : "text-primary border-primary/30")}>
                                TS: {item.technicalStrength}
                              </Badge>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-6 px-2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                                onClick={() => handleRemoveWatchlist(item.id, item.symbol)}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

function StatCard({ title, value, icon, description, valueColor = "text-foreground" }: { title: string, value: React.ReactNode, icon: React.ReactNode, description?: string | false, valueColor?: string }) {
  return (
    <Card className="bg-card border-border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold font-mono tracking-tight", valueColor)}>
          {value}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MoverRow({ stock, type }: { stock: Stock, type: "gainer" | "loser" }) {
  const isGainer = type === "gainer";
  return (
    <div className="p-4 flex items-center justify-between hover:bg-accent/30 transition-colors group">
      <div className="flex items-center gap-4">
        <div className={cn("p-2 rounded-full shrink-0", isGainer ? "bg-success/10" : "bg-destructive/10")}>
          {isGainer ? <TrendingUp className="h-4 w-4 text-success" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
        </div>
        <div>
          <Link href="/" className="font-bold font-mono text-sm group-hover:text-primary transition-colors">{stock.symbol}</Link>
          <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
            <span className="truncate max-w-[150px]">{stock.name}</span>
            <span className="h-1 w-1 rounded-full bg-border"></span>
            <span className="font-mono text-xs">Vol: {formatNumber(stock.volume)}</span>
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono font-bold">{formatCurrency(stock.price)}</div>
        <div className={cn("text-xs font-mono font-medium flex items-center justify-end gap-1 mt-0.5", isGainer ? "text-success" : "text-destructive")}>
          {isGainer ? "+" : ""}{formatPercent(stock.changePercent)}
        </div>
      </div>
    </div>
  );
}
