import { useMemo, useState } from "react";
import { useListStocks, useGetWatchlist } from "@workspace/api-client-react";
import { ArrowDownRight, ArrowUpRight, BarChart2, ChevronDown, Search, SlidersHorizontal, Star, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatCurrency, formatPercent } from "@/lib/format";

interface StockListPanelProps {
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
}

type MainTab = "ideas" | "watchlist" | "portfolio";
type IdeaFilter = "all" | "bullish" | "bearish" | "highIv";
type SortKey = "strength" | "move" | "symbol";

function getStrategyLabel(changePercent: number, strength: number): { label: string; tone: "bull" | "bear" | "neutral" } {
  if (strength >= 8 && changePercent > 0) return { label: "Breakout", tone: "bull" };
  if (strength <= 3 && changePercent < 0) return { label: "Bear Put", tone: "bear" };
  if (Math.abs(changePercent) < 0.8) return { label: "Neutral", tone: "neutral" };
  if (changePercent > 0) return { label: "Call Spread", tone: "bull" };
  return { label: "Put Spread", tone: "bear" };
}

function getScore(strength: number, changePercent: number) {
  return Math.min(200, Math.max(40, Math.round(strength * 16 + Math.abs(changePercent) * 6)));
}

const TABS: { id: MainTab; label: string }[] = [
  { id: "ideas", label: "Ideas" },
  { id: "watchlist", label: "Watchlist" },
  { id: "portfolio", label: "Portfolio" },
];

const FILTERS: { id: IdeaFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "bullish", label: "Bullish" },
  { id: "bearish", label: "Bearish" },
  { id: "highIv", label: "High IV" },
];

export function StockListPanel({ selectedSymbol, onSelect }: StockListPanelProps) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<MainTab>("ideas");
  const [filter, setFilter] = useState<IdeaFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("strength");

  const { data: stocks = [], isLoading: loadingStocks } = useListStocks({ search, limit: 50 });
  const { data: watchlist = [], isLoading: loadingWatchlist } = useGetWatchlist();

  const watchlistSymbols = new Set(watchlist.map((w) => w.symbol));

  const items = useMemo(() => {
    const source = tab === "watchlist" ? watchlist : stocks;
    const q = search.trim().toLowerCase();

    let filtered = source.filter((item) => {
      if (q && !item.symbol.toLowerCase().includes(q) && !item.name.toLowerCase().includes(q)) return false;
      if (tab !== "ideas") return true;
      if (filter === "bullish") return item.changePercent > 0 && item.technicalStrength >= 6;
      if (filter === "bearish") return item.changePercent < 0 || item.technicalStrength <= 4;
      if (filter === "highIv") return Math.abs(item.changePercent) > 1.5 || item.technicalStrength >= 8;
      return true;
    });

    filtered = [...filtered].sort((a, b) => {
      if (sortKey === "strength") return b.technicalStrength - a.technicalStrength;
      if (sortKey === "move") return Math.abs(b.changePercent) - Math.abs(a.changePercent);
      return a.symbol.localeCompare(b.symbol);
    });

    return filtered;
  }, [filter, search, sortKey, stocks, tab, watchlist]);

  const isLoading = tab === "watchlist" ? loadingWatchlist : loadingStocks;
  const sortLabels: Record<SortKey, string> = { strength: "Strength", move: "Move %", symbol: "A–Z" };

  return (
    <div className="flex h-full flex-col" style={{ background: "hsl(0 0% 5%)", borderRight: "1px solid rgba(255,255,255,0.05)" }}>
      {/* Tab bar */}
      <div style={{ padding: "16px 16px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 3, marginBottom: 12 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                padding: "5px 0",
                borderRadius: 6,
                border: "none",
                fontSize: 12,
                fontWeight: tab === t.id ? 600 : 400,
                color: tab === t.id ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                background: tab === t.id ? "rgba(255,255,255,0.09)" : "transparent",
                cursor: "pointer",
                transition: "all 0.15s",
                letterSpacing: "-0.01em",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search + sort */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "hsl(var(--muted-foreground))", pointerEvents: "none" }} />
            <input
              type="search"
              placeholder="Search symbol…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "7px 10px 7px 28px",
                fontSize: 12,
                borderRadius: 7,
                border: "1px solid rgba(255,255,255,0.07)",
                background: "rgba(255,255,255,0.04)",
                color: "hsl(var(--foreground))",
                outline: "none",
                letterSpacing: "-0.01em",
              }}
            />
          </div>
          <button
            onClick={() => setSortKey(sortKey === "strength" ? "move" : sortKey === "move" ? "symbol" : "strength")}
            title={`Sort: ${sortLabels[sortKey]}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: 7,
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.04)",
              color: "hsl(var(--muted-foreground))",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <SlidersHorizontal style={{ width: 13, height: 13 }} />
          </button>
        </div>

        {/* Filter pills — only in ideas tab */}
        {tab === "ideas" && (
          <div style={{ display: "flex", gap: 4, paddingBottom: 12 }}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                style={{
                  flex: 1,
                  padding: "4px 0",
                  borderRadius: 5,
                  border: filter === f.id ? "1px solid hsl(var(--primary) / 0.4)" : "1px solid rgba(255,255,255,0.06)",
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: "0.02em",
                  color: filter === f.id ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                  background: filter === f.id ? "hsl(var(--primary) / 0.08)" : "transparent",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {/* Column headers */}
        <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: 8, paddingTop: 2 }}>
          <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>
            {tab === "ideas" ? "Scanner" : tab === "watchlist" ? "Watchlist" : "Portfolio"} · {items.length}
          </span>
          <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>
            {sortLabels[sortKey]}
          </span>
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div style={{ padding: "6px 8px 24px" }}>
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ height: 72, borderRadius: 8, background: "rgba(255,255,255,0.035)", margin: "3px 0", animation: "pulse 1.4s infinite" }} />
            ))
          ) : tab === "portfolio" ? (
            <div style={{ margin: "32px 8px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
              <BarChart2 style={{ width: 28, height: 28, opacity: 0.25, margin: "0 auto 10px" }} />
              Portfolio coming soon
            </div>
          ) : items.length === 0 ? (
            <div style={{ padding: "40px 8px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>No results</div>
          ) : (
            items.map((item) => {
              const isSelected = item.symbol === selectedSymbol;
              const isUp = item.change >= 0;
              const strategy = getStrategyLabel(item.changePercent, item.technicalStrength);
              const score = getScore(item.technicalStrength, item.changePercent);
              const isWatched = watchlistSymbols.has(item.symbol);

              return (
                <button
                  key={item.symbol}
                  onClick={() => onSelect(item.symbol)}
                  style={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    padding: "10px 10px",
                    borderRadius: 8,
                    border: isSelected ? "1px solid hsl(var(--primary) / 0.25)" : "1px solid transparent",
                    background: isSelected ? "hsl(var(--primary) / 0.07)" : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.12s",
                    marginBottom: 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  }}
                >
                  {/* Row 1: symbol + badge | price + change */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{
                          fontSize: 13,
                          fontWeight: 600,
                          letterSpacing: "-0.02em",
                          color: isSelected ? "hsl(var(--primary))" : "hsl(var(--foreground))",
                        }}>
                          {item.symbol}
                        </span>
                        {isWatched && (
                          <Star style={{ width: 10, height: 10, fill: "hsl(var(--primary))", color: "hsl(var(--primary))", flexShrink: 0 }} />
                        )}
                        <span style={{
                          fontSize: 9,
                          fontWeight: 600,
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                          padding: "1.5px 5px",
                          borderRadius: 3,
                          color: strategy.tone === "bull" ? "hsl(var(--success))" : strategy.tone === "bear" ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))",
                          background: strategy.tone === "bull" ? "hsl(var(--success) / 0.10)" : strategy.tone === "bear" ? "hsl(var(--destructive) / 0.10)" : "rgba(255,255,255,0.05)",
                        }}>
                          {strategy.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
                        {item.name}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                        {formatCurrency(item.price)}
                      </div>
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 2,
                        fontSize: 11,
                        fontWeight: 500,
                        marginTop: 2,
                        color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))",
                        fontVariantNumeric: "tabular-nums",
                      }}>
                        {isUp ? <ArrowUpRight style={{ width: 10, height: 10 }} /> : <ArrowDownRight style={{ width: 10, height: 10 }} />}
                        {formatPercent(Math.abs(item.changePercent))}
                      </div>
                    </div>
                  </div>

                  {/* Row 2: strength bar + score */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 2, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          borderRadius: 99,
                          width: `${(item.technicalStrength / 10) * 100}%`,
                          background: item.technicalStrength >= 7 ? "hsl(var(--success))" : item.technicalStrength <= 3 ? "hsl(var(--destructive))" : "hsl(var(--primary))",
                          opacity: 0.75,
                          transition: "width 0.4s",
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", letterSpacing: "0.03em", flexShrink: 0 }}>
                      {item.technicalStrength}/10
                    </span>
                    <span style={{
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      fontVariantNumeric: "tabular-nums",
                      color: score >= 130 ? "hsl(var(--success))" : score <= 75 ? "hsl(var(--destructive))" : "hsl(var(--primary))",
                    }}>
                      {score}
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
