import { useMemo, useState } from "react";
import { useListStocks, useGetWatchlist } from "@workspace/api-client-react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bookmark,
  Brain,
  ChevronDown,
  Flame,
  Gauge,
  Layers3,
  Search,
  Settings2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatCurrency, formatPercent } from "@/lib/format";

interface StockListPanelProps {
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
}

type MainTab = "ideas" | "watchlists" | "portfolio";
type IdeaFilter = "technical" | "bullish" | "bearish" | "highIv";
type SortKey = "symbol" | "strength" | "move";

const ideaFilters: Array<{ id: IdeaFilter; label: string; icon: typeof BarChart3 }> = [
  { id: "technical", label: "Technical Ideas", icon: BarChart3 },
  { id: "bullish", label: "Bullish Momentum", icon: ArrowUpRight },
  { id: "bearish", label: "Bearish Setups", icon: ArrowDownRight },
  { id: "highIv", label: "High IV Rank", icon: Zap },
];

function getStrategyLabel(changePercent: number, strength: number) {
  if (strength >= 8 && changePercent > 0) return { label: "Breakout", tone: "bullish" };
  if (strength <= 4 && changePercent < 0) return { label: "Bear Put", tone: "bearish" };
  if (Math.abs(changePercent) < 1) return { label: "Neutral", tone: "neutral" };
  if (changePercent > 0) return { label: "Call Spread", tone: "bullish" };
  return { label: "Put Spread", tone: "bearish" };
}

function getIdeaScore(strength: number, changePercent: number) {
  return Math.min(200, Math.max(40, Math.round(strength * 16 + Math.abs(changePercent) * 7)));
}

export function StockListPanel({ selectedSymbol, onSelect }: StockListPanelProps) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<MainTab>("ideas");
  const [filter, setFilter] = useState<IdeaFilter>("technical");
  const [sortKey, setSortKey] = useState<SortKey>("strength");

  const { data: stocks = [], isLoading: isLoadingStocks } = useListStocks({ search, limit: 50 });
  const { data: watchlist = [], isLoading: isLoadingWatchlist } = useGetWatchlist();

  const watchlistSymbols = new Set(watchlist.map((item) => item.symbol));
  const activeFilter = ideaFilters.find((item) => item.id === filter) ?? ideaFilters[0];
  const ActiveIcon = activeFilter.icon;

  const displayData = useMemo(() => {
    const source = tab === "watchlists" ? watchlist : stocks;
    const normalizedSearch = search.trim().toLowerCase();

    let filtered = source.filter((item) => {
      const matchesSearch =
        !normalizedSearch ||
        item.symbol.toLowerCase().includes(normalizedSearch) ||
        item.name.toLowerCase().includes(normalizedSearch);

      if (!matchesSearch) return false;
      if (tab !== "ideas") return true;

      if (filter === "bullish") return item.changePercent > 0 && item.technicalStrength >= 6;
      if (filter === "bearish") return item.changePercent < 0 || item.technicalStrength <= 4;
      if (filter === "highIv") return Math.abs(item.changePercent) > 1.5 || item.technicalStrength >= 8 || item.technicalStrength <= 3;
      return true;
    });

    filtered = [...filtered].sort((a, b) => {
      if (sortKey === "strength") return b.technicalStrength - a.technicalStrength;
      if (sortKey === "move") return Math.abs(b.changePercent) - Math.abs(a.changePercent);
      return a.symbol.localeCompare(b.symbol);
    });

    return filtered;
  }, [filter, search, sortKey, stocks, tab, watchlist]);

  const isLoading = tab === "watchlists" ? isLoadingWatchlist : isLoadingStocks;

  return (
    <div className="flex h-full flex-col bg-background/95 backdrop-blur-md border-r border-white/5">
      <div className="p-3 shrink-0 flex flex-col gap-3 border-b border-white/5">
        <Tabs value={tab} onValueChange={(v) => setTab(v as MainTab)} className="w-full">
          <TabsList className="w-full h-9 bg-white/[0.04] p-1 rounded-xl grid grid-cols-3">
            <TabsTrigger value="ideas" className="text-[11px] rounded-lg data-[state=active]:bg-white/12 data-[state=active]:text-foreground transition-all">
              Ideas
            </TabsTrigger>
            <TabsTrigger value="watchlists" className="text-[11px] rounded-lg data-[state=active]:bg-white/12 data-[state=active]:text-foreground transition-all">
              Watchlists
            </TabsTrigger>
            <TabsTrigger value="portfolio" className="text-[11px] rounded-lg data-[state=active]:bg-white/12 data-[state=active]:text-foreground transition-all">
              Portfolio
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <button className="flex w-full items-center justify-between rounded-xl bg-black/30 px-3 py-2 text-left transition-colors hover:bg-white/[0.06]">
            <span className="flex items-center gap-2 text-xs font-medium text-foreground/90">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/12 text-primary">
                <ActiveIcon className="h-3.5 w-3.5" />
              </span>
              {activeFilter.label}
            </span>
            <span className="flex items-center gap-2 text-[10px] font-mono text-success">
              {displayData.length}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </button>

          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {ideaFilters.map((item) => {
              const Icon = item.icon;
              const active = item.id === filter;
              return (
                <button
                  key={item.id}
                  onClick={() => setFilter(item.id)}
                  className={cn(
                    "flex h-8 items-center justify-center rounded-lg border transition-all",
                    active
                      ? "border-primary/30 bg-primary/12 text-primary shadow-[0_0_20px_rgba(10,132,255,0.08)]"
                      : "border-white/[0.06] bg-white/[0.03] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground"
                  )}
                  title={item.label}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Symbol"
              className="pl-9 bg-white/[0.04] border-white/[0.06] focus-visible:ring-1 focus-visible:ring-primary/40 h-9 text-sm rounded-xl transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => setSortKey(sortKey === "strength" ? "move" : sortKey === "move" ? "symbol" : "strength")}
            className="flex h-9 w-10 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.04] text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
            title={`Sort by ${sortKey}`}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
          <span className="flex items-center gap-1.5">
            <Settings2 className="h-3 w-3" />
            Scanner
          </span>
          <span>{sortKey === "strength" ? "Strength" : sortKey === "move" ? "Move" : "Symbol"}</span>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col p-2 gap-1.5 pb-4">
          {isLoading ? (
            Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-[92px] animate-pulse bg-white/5 rounded-2xl mx-1 my-1" />
            ))
          ) : displayData.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No matching ideas found.
            </div>
          ) : tab === "portfolio" ? (
            <div className="m-2 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4 text-sm text-muted-foreground">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.06] text-primary">
                <Layers3 className="h-5 w-5" />
              </div>
              Portfolio analytics will appear here when live positions are connected. For now, use Ideas and Watchlists to explore strategies.
            </div>
          ) : (
            displayData.map((item) => {
              const isSelected = item.symbol === selectedSymbol;
              const isUp = item.change >= 0;
              const strategy = getStrategyLabel(item.changePercent, item.technicalStrength);
              const score = getIdeaScore(item.technicalStrength, item.changePercent);
              const scoreTone = score >= 130 ? "text-success" : score <= 75 ? "text-destructive" : "text-primary";
              return (
                <button
                  key={item.symbol}
                  onClick={() => onSelect(item.symbol)}
                  className={cn(
                    "group flex flex-col text-left px-3 py-3 rounded-2xl transition-all duration-200 border",
                    isSelected
                      ? "bg-primary/10 border-primary/25 shadow-[0_8px_30px_rgba(10,132,255,0.12)]"
                      : "bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.055] hover:border-white/[0.09]"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn("font-semibold tracking-tight text-sm", isSelected ? "text-primary" : "text-foreground")}>{item.symbol}</span>
                        {watchlistSymbols.has(item.symbol) && <Star className="h-3.5 w-3.5 fill-primary text-primary" />}
                        <span
                          className={cn(
                            "rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]",
                            strategy.tone === "bullish" && "bg-success/10 text-success",
                            strategy.tone === "bearish" && "bg-destructive/10 text-destructive",
                            strategy.tone === "neutral" && "bg-white/[0.06] text-muted-foreground"
                          )}
                        >
                          {strategy.label}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground max-w-[160px]">{item.name}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm tracking-tight">{formatCurrency(item.price)}</div>
                      <div className={cn("mt-1 flex items-center justify-end text-xs font-mono font-medium", isUp ? "text-success" : "text-destructive")}>
                        {isUp ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
                        {formatPercent(Math.abs(item.changePercent))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-3">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <Gauge className="h-3 w-3" />
                        <span>Strength {item.technicalStrength}/10</span>
                        {filter === "highIv" && (
                          <span className="ml-auto flex items-center gap-1 text-primary">
                            <Flame className="h-3 w-3" />
                            IV
                          </span>
                        )}
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.055]">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            item.technicalStrength >= 7 ? "bg-success/80" : item.technicalStrength <= 3 ? "bg-destructive/80" : "bg-primary/80"
                          )}
                          style={{ width: `${(item.technicalStrength / 10) * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Score</span>
                      <span className={cn("font-mono text-lg leading-none", scoreTone)}>{score}</span>
                    </div>
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
