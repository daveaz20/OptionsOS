import { useState } from "react";
import { useListStocks, useGetWatchlist } from "@workspace/api-client-react";
import { Search, Star, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatCurrency, formatPercent } from "@/lib/format";

interface StockListPanelProps {
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
}

export function StockListPanel({ selectedSymbol, onSelect }: StockListPanelProps) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "watchlist">("all");

  const { data: stocks = [], isLoading: isLoadingStocks } = useListStocks({ search, limit: 50 });
  const { data: watchlist = [], isLoading: isLoadingWatchlist } = useGetWatchlist();

  const watchlistSymbols = new Set(watchlist.map((item) => item.symbol));
  
  const displayData = tab === "watchlist" 
    ? watchlist.filter(w => !search || w.symbol.toLowerCase().includes(search.toLowerCase()) || w.name.toLowerCase().includes(search.toLowerCase()))
    : stocks;

  const isLoading = tab === "watchlist" ? isLoadingWatchlist : isLoadingStocks;

  return (
    <div className="flex h-full flex-col bg-background/95 backdrop-blur-md border-r border-white/5">
      <div className="p-4 shrink-0 flex flex-col gap-4 border-b border-white/5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search symbols..."
            className="pl-9 bg-white/5 border-transparent focus-visible:ring-1 focus-visible:ring-primary/50 h-9 text-sm rounded-lg transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
          <TabsList className="w-full h-8 bg-white/5 p-1 rounded-lg">
            <TabsTrigger value="all" className="flex-1 text-xs rounded-md data-[state=active]:bg-white/10 data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
              All Stocks
            </TabsTrigger>
            <TabsTrigger value="watchlist" className="flex-1 text-xs rounded-md data-[state=active]:bg-white/10 data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">
              Watchlist
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col p-2 gap-1 pb-4">
          {isLoading ? (
            Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-[72px] animate-pulse bg-white/5 rounded-lg mx-2 my-1" />
            ))
          ) : displayData.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No results found.
            </div>
          ) : (
            displayData.map((item) => {
              const isSelected = item.symbol === selectedSymbol;
              const isUp = item.change >= 0;
              return (
                <button
                  key={item.symbol}
                  onClick={() => onSelect(item.symbol)}
                  className={cn(
                    "flex flex-col text-left px-3 py-2.5 rounded-lg transition-all duration-200 border",
                    isSelected
                      ? "bg-primary/10 border-primary/20 shadow-[0_0_15px_rgba(10,132,255,0.05)]"
                      : "bg-transparent border-transparent hover:bg-white/5 hover:border-white/10"
                  )}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      <span className={cn("font-medium tracking-tight text-sm", isSelected ? "text-primary" : "text-foreground")}>
                        {item.symbol}
                      </span>
                      {watchlistSymbols.has(item.symbol) && (
                        <Star className={cn("h-3.5 w-3.5", isSelected ? "fill-primary text-primary" : "fill-foreground/50 text-foreground/50")} />
                      )}
                    </div>
                    <span className="font-mono text-sm tracking-tight">{formatCurrency(item.price)}</span>
                  </div>
                  <div className="flex items-center justify-between w-full mt-1">
                    <span className="text-xs text-muted-foreground truncate max-w-[140px] font-medium">
                      {item.name}
                    </span>
                    <span className={cn("flex items-center text-xs font-mono font-medium", isUp ? "text-success" : "text-destructive")}>
                      {isUp ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
                      {formatPercent(Math.abs(item.changePercent))}
                    </span>
                  </div>
                  
                  {/* Refined Strength Indicator */}
                  <div className="w-full flex items-center gap-2 mt-2.5">
                    <div className="h-1 flex-1 bg-white/5 rounded-full overflow-hidden">
                      <div 
                        className={cn("h-full rounded-full transition-all duration-500", 
                          item.technicalStrength >= 7 ? "bg-success/80 shadow-[0_0_8px_rgba(48,209,88,0.5)]" : 
                          item.technicalStrength <= 3 ? "bg-destructive/80 shadow-[0_0_8px_rgba(255,69,58,0.5)]" : 
                          "bg-primary/80 shadow-[0_0_8px_rgba(10,132,255,0.5)]"
                        )}
                        style={{ width: `${(item.technicalStrength / 10) * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-medium text-muted-foreground w-6 text-right">
                      {item.technicalStrength}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
