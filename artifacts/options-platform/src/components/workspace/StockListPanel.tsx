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
    <div className="flex h-full flex-col border-r border-border bg-card">
      <div className="p-4 shrink-0 flex flex-col gap-4 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search symbols..."
            className="pl-9 bg-background/50 border-border focus-visible:ring-primary h-9 font-mono text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
          <TabsList className="w-full h-8 bg-background/50 p-0.5">
            <TabsTrigger value="all" className="flex-1 text-xs data-[state=active]:bg-card data-[state=active]:text-primary">
              All Stocks
            </TabsTrigger>
            <TabsTrigger value="watchlist" className="flex-1 text-xs data-[state=active]:bg-card data-[state=active]:text-primary">
              Watchlist
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col p-2 gap-1">
          {isLoading ? (
            Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse bg-muted/30 rounded-md" />
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
                    "flex flex-col text-left p-3 rounded-md transition-all border border-transparent",
                    isSelected
                      ? "bg-primary/5 border-primary/30"
                      : "hover:bg-accent/50"
                  )}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      <span className={cn("font-bold font-mono text-sm", isSelected ? "text-primary" : "text-foreground")}>
                        {item.symbol}
                      </span>
                      {watchlistSymbols.has(item.symbol) && (
                        <Star className="h-3 w-3 fill-primary text-primary opacity-70" />
                      )}
                    </div>
                    <span className="font-mono text-sm">{formatCurrency(item.price)}</span>
                  </div>
                  <div className="flex items-center justify-between w-full mt-1">
                    <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                      {item.name}
                    </span>
                    <span className={cn("flex items-center text-xs font-mono font-medium", isUp ? "text-success" : "text-destructive")}>
                      {isUp ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
                      {formatPercent(item.changePercent)}
                    </span>
                  </div>
                  <div className="w-full flex items-center gap-1.5 mt-2">
                    <div className="h-1 flex-1 bg-background rounded-full overflow-hidden">
                      <div 
                        className={cn("h-full rounded-full", item.technicalStrength >= 7 ? "bg-success" : item.technicalStrength <= 3 ? "bg-destructive" : "bg-primary")}
                        style={{ width: `${(item.technicalStrength / 10) * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">TS: {item.technicalStrength}</span>
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
