import { useState, useEffect } from "react";
import { useGetStrategies, useCalculatePnl } from "@workspace/api-client-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { formatCurrency, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Target, TrendingUp, Info } from "lucide-react";
import type { OptionsStrategy, GetStrategiesOutlook } from "@workspace/api-client-react";

interface StrategyPanelProps {
  symbol: string;
  currentPrice?: number;
}

export function StrategyPanel({ symbol, currentPrice = 0 }: StrategyPanelProps) {
  const [outlook, setOutlook] = useState<GetStrategiesOutlook>("bullish");
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null);

  const { data: strategies = [], isLoading } = useGetStrategies(symbol, { outlook }, { query: { enabled: !!symbol } });

  // Auto-select first strategy when loaded
  useEffect(() => {
    if (strategies.length > 0 && !selectedStrategyId) {
      setSelectedStrategyId(strategies[0].id);
    } else if (strategies.length === 0) {
      setSelectedStrategyId(null);
    }
  }, [strategies, selectedStrategyId]);

  if (!symbol) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground p-8 text-center bg-background/95 backdrop-blur-md border-l border-white/5">
        <Target className="h-12 w-12 mb-4 opacity-20" />
        <p className="text-lg font-medium text-foreground">Strategies</p>
        <p className="text-sm mt-1">Select a stock to view recommended options strategies.</p>
      </div>
    );
  }

  const selectedStrategy = strategies.find(s => s.id === selectedStrategyId);

  return (
    <div className="flex h-full flex-col border-l border-white/5 bg-background/95 backdrop-blur-md">
      <div className="p-4 shrink-0 flex flex-col gap-4 border-b border-white/5">
        <h2 className="font-semibold text-lg flex items-center gap-2 tracking-tight">
          Strategies
        </h2>
        <Tabs value={outlook} onValueChange={(v) => { setOutlook(v as GetStrategiesOutlook); setSelectedStrategyId(null); }} className="w-full">
          <TabsList className="w-full h-8 bg-white/5 p-1 rounded-lg grid grid-cols-3">
            <TabsTrigger value="bullish" className="text-xs rounded-md data-[state=active]:bg-success/20 data-[state=active]:text-success transition-all">
              Bullish
            </TabsTrigger>
            <TabsTrigger value="neutral" className="text-xs rounded-md data-[state=active]:bg-white/10 data-[state=active]:text-foreground transition-all">
              Neutral
            </TabsTrigger>
            <TabsTrigger value="bearish" className="text-xs rounded-md data-[state=active]:bg-destructive/20 data-[state=active]:text-destructive transition-all">
              Bearish
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col p-4 gap-5 pb-8">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px] w-full rounded-xl bg-white/5" />
            ))
          ) : strategies.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm flex flex-col items-center gap-3">
              <AlertCircle className="h-8 w-8 opacity-30" />
              <span>No {outlook} strategies found.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {strategies.map((strategy) => (
                <StrategyCard 
                  key={strategy.id} 
                  strategy={strategy} 
                  isSelected={strategy.id === selectedStrategyId}
                  onClick={() => setSelectedStrategyId(strategy.id)}
                />
              ))}
            </div>
          )}

          {selectedStrategy && (
            <div className="mt-2 border-t border-white/5 pt-6 flex flex-col gap-5">
              <h3 className="font-semibold text-base flex items-center gap-2 tracking-tight">
                <TrendingUp className="h-4.5 w-4.5 text-primary" />
                P&L Simulator
              </h3>
              <PnlSimulator strategy={selectedStrategy} symbol={symbol} currentPrice={currentPrice} />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function StrategyCard({ strategy, isSelected, onClick }: { strategy: OptionsStrategy, isSelected: boolean, onClick: () => void }) {
  const scorePercent = Math.min(Math.max(strategy.score / 200, 0), 1) * 100;
  
  let scoreColor = "bg-primary";
  if (strategy.score > 120) scoreColor = "bg-success";
  if (strategy.score < 80) scoreColor = "bg-destructive";

  return (
    <div 
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-xl border p-4 transition-all duration-300 relative overflow-hidden",
        isSelected 
          ? "bg-primary/10 border-primary/30 shadow-[0_4px_20px_rgba(10,132,255,0.1)]" 
          : "bg-card/40 backdrop-blur-xl border-white/5 hover:border-white/20 hover:bg-white/5"
      )}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <h4 className={cn("font-semibold text-sm tracking-tight", isSelected ? "text-foreground" : "text-foreground/90")}>{strategy.name}</h4>
          <p className="text-xs text-muted-foreground mt-1 flex gap-2 items-center font-medium">
            <span>{strategy.type === "income" ? "Income" : "Trade"}</span>
            <span className="h-1 w-1 rounded-full bg-white/20"></span>
            <span>Exp: {strategy.expirationDate}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Score <span className="text-foreground ml-1">{strategy.score}</span></span>
          <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all duration-500", scoreColor)} style={{ width: `${scorePercent}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-white/5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Cost</span>
          <span className="font-mono text-sm font-medium">{formatCurrency(strategy.tradeCost)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Max Profit</span>
          <span className="font-mono text-sm font-medium text-success">{formatCurrency(strategy.maxProfit)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Return</span>
          <span className="font-mono text-sm font-medium text-primary">{formatPercent(strategy.returnPercent)}</span>
        </div>
      </div>
    </div>
  );
}

function PnlSimulator({ strategy, symbol, currentPrice }: { strategy: OptionsStrategy, symbol: string, currentPrice: number }) {
  const [targetPrice, setTargetPrice] = useState(currentPrice || 100);
  const [daysToExpiry, setDaysToExpiry] = useState(30);
  const [iv, setIv] = useState(30);

  const today = new Date();
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + daysToExpiry);

  const { data: pnlData, isLoading } = useCalculatePnl({
    mutation: {
      mutationKey: ["calculatePnl", strategy.id, targetPrice, daysToExpiry, iv]
    }
  });

  const calculatePnl = useCalculatePnl();

  useEffect(() => {
    if (currentPrice > 0 && targetPrice === 0) {
      setTargetPrice(currentPrice);
    }
    
    const timer = setTimeout(() => {
      const targetDateStr = targetDate.toISOString().split('T')[0];
      calculatePnl.mutate({
        symbol,
        data: {
          strategyId: strategy.id,
          targetPrice,
          targetDate: targetDateStr,
          impliedVolatility: iv
        }
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [strategy.id, targetPrice, daysToExpiry, iv, currentPrice, symbol]);

  const pnlResult = pnlData;

  const minPriceBound = currentPrice * 0.7;
  const maxPriceBound = currentPrice * 1.3;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-5 bg-card/40 backdrop-blur-xl p-5 rounded-2xl border border-white/5 shadow-sm">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Target Price</label>
            <span className="font-mono text-sm font-medium text-foreground">{formatCurrency(targetPrice)}</span>
          </div>
          <Slider 
            value={[targetPrice]} 
            min={minPriceBound} 
            max={maxPriceBound} 
            step={0.1}
            onValueChange={([val]) => setTargetPrice(val)} 
            className="py-1"
          />
        </div>

        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Days to Expiration</label>
            <span className="font-mono text-sm font-medium text-foreground">{daysToExpiry} Days</span>
          </div>
          <Slider 
            value={[daysToExpiry]} 
            min={0} 
            max={90} 
            step={1}
            onValueChange={([val]) => setDaysToExpiry(val)} 
            className="py-1"
          />
        </div>

        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Implied Volatility (IV)</label>
            <span className="font-mono text-sm font-medium text-foreground">{iv}%</span>
          </div>
          <Slider 
            value={[iv]} 
            min={10} 
            max={150} 
            step={1}
            onValueChange={([val]) => setIv(val)} 
            className="py-1"
          />
        </div>
      </div>

      {isLoading && !pnlResult ? (
        <Skeleton className="h-[260px] w-full rounded-2xl bg-white/5" />
      ) : pnlResult ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className={cn(
              "p-4 rounded-2xl border flex flex-col gap-1 items-center justify-center text-center transition-colors",
              pnlResult.profitLoss >= 0 
                ? "bg-success/10 border-success/20 text-success" 
                : "bg-destructive/10 border-destructive/20 text-destructive"
            )}>
              <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80 mb-1">Simulated P&L</span>
              <span className="text-2xl font-medium tracking-tight font-mono">{formatCurrency(pnlResult.profitLoss)}</span>
              <span className="text-xs font-mono font-medium opacity-90">{formatPercent(pnlResult.profitLossPercent)}</span>
            </div>
            
            <div className="p-4 rounded-2xl border border-white/5 bg-card/40 backdrop-blur-xl flex flex-col gap-1 justify-center items-center text-center">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Breakeven</span>
              <span className="text-xl font-medium tracking-tight font-mono text-foreground">{formatCurrency(pnlResult.breakeven)}</span>
            </div>
          </div>

          {pnlResult.pnlCurve && pnlResult.pnlCurve.length > 0 && (
            <div className="h-[200px] w-full bg-card/40 backdrop-blur-xl rounded-2xl border border-white/5 p-3 pt-5 shadow-sm">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={pnlResult.pnlCurve} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pnlColor" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis 
                    dataKey="price" 
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(val) => `$${val}`}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickMargin={8}
                    minTickGap={20}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis 
                    hide
                    domain={['dataMin', 'dataMax']}
                  />
                  <RechartsTooltip
                    cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 4' }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        const isProfit = data.pnl >= 0;
                        return (
                          <div className="bg-card/80 backdrop-blur-xl border border-white/10 p-3 rounded-xl shadow-2xl font-mono text-xs min-w-[140px]">
                            <div className="text-muted-foreground mb-2 font-sans font-medium">Price: {formatCurrency(data.price)}</div>
                            <div className={cn("font-medium text-sm", isProfit ? "text-success" : "text-destructive")}>
                              P&L: {formatCurrency(data.pnl)}
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.4} />
                  <ReferenceLine x={currentPrice} stroke="hsl(var(--foreground))" strokeDasharray="3 3" opacity={0.2} />
                  <Area 
                    type="monotone" 
                    dataKey="pnl" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2.5}
                    fillOpacity={1} 
                    fill="url(#pnlColor)" 
                    animationDuration={800}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
