import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListStocks, useGetWatchlist } from "@workspace/api-client-react";
import { ArrowDownRight, ArrowUpRight, ChevronDown, Search, SlidersHorizontal, Star, Zap } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { Stock, WatchlistItem } from "@workspace/api-client-react";

interface StockListPanelProps {
  selectedSymbol: string;
  onSelect: (symbol: string, stock?: Stock) => void;
  initialTab?: MainTab;
}

type MainTab = "ideas" | "watchlist";
type IdeaFilter = "all" | "bullish" | "bearish" | "highIv" | "etfs";
type SortKey = "opportunity" | "ivRank" | "move" | "symbol";

const FILTERS: { id: IdeaFilter; label: string }[] = [
  { id: "all",     label: "All" },
  { id: "bullish", label: "Bullish" },
  { id: "bearish", label: "Bearish" },
  { id: "highIv",  label: "High IV" },
  { id: "etfs",    label: "ETFs" },
];

// ─── ETF badge config (driven by etfCategory from API response) ──────────────
const ETF_BADGE_LABEL: Record<string, string> = {
  "leveraged-bull":    "3× Bull",
  "leveraged-bear":    "3× Bear",
  "leveraged-single":  "Single-Stock",
  "sector":            "Sector",
};

const ETF_BADGE_COLOR: Record<string, string> = {
  "leveraged-bull":   "hsl(var(--success))",
  "leveraged-bear":   "hsl(var(--destructive))",
  "leveraged-single": "#c084fc",   // purple — distinct from directional green/red
  "sector":           "hsl(var(--primary))",
};

const sortLabels: Record<SortKey, string> = {
  opportunity: "Score",
  ivRank:      "IV Rank",
  move:        "Move %",
  symbol:      "A–Z",
};

// Score color: green ≥ 65, yellow ≥ 45, red < 45
function scoreColor(score: number): string {
  if (score >= 65) return "hsl(var(--success))";
  if (score >= 45) return "hsl(var(--primary))";
  return "hsl(var(--muted-foreground))";
}

function setupTone(outlook?: string): "bull" | "bear" | "neutral" {
  if (outlook === "bullish") return "bull";
  if (outlook === "bearish") return "bear";
  return "neutral";
}

// Compact label for the setup badge — handles registry IDs (snake_case) and legacy names
function shortLabel(setupType?: string): string {
  if (!setupType) return "Neutral";
  // Registry ID → display name (truncated for badge width)
  const registryMap: Record<string, string> = {
    covered_call: "Cov. Call",
    protective_put: "Prot. Put",
    collar: "Collar",
    cash_secured_put: "CSP",
    long_call: "Long Call",
    long_put: "Long Put",
    fig_leaf: "Fig Leaf",
    long_call_spread: "Call Spd",
    long_put_spread: "Put Spd",
    short_call_spread: "Short Call Spd",
    short_put_spread: "Short Put Spd",
    long_straddle: "Straddle",
    long_strangle: "Strangle",
    back_spread_calls: "Back Spd C",
    back_spread_puts: "Back Spd P",
    long_calendar_calls: "Cal Spd C",
    long_calendar_puts: "Cal Spd P",
    diagonal_spread_calls: "Diag C",
    diagonal_spread_puts: "Diag P",
    long_butterfly_calls: "Bfly C",
    long_butterfly_puts: "Bfly P",
    iron_butterfly: "Iron Bfly",
    skip_strike_butterfly_calls: "Skip Bfly C",
    skip_strike_butterfly_puts: "Skip Bfly P",
    inverse_skip_strike_butterfly_calls: "Inv Skip C",
    inverse_skip_strike_butterfly_puts: "Inv Skip P",
    christmas_tree_butterfly_calls: "Xmas Tree C",
    christmas_tree_butterfly_puts: "Xmas Tree P",
    long_condor_calls: "Condor C",
    long_condor_puts: "Condor P",
    iron_condor: "Iron Condor",
    short_call: "Short Call",
    short_put: "Short Put",
    short_straddle: "Sh. Straddle",
    short_strangle: "Sh. Strangle",
    long_combination: "Long Combo",
    short_combination: "Short Combo",
    front_spread_calls: "Front Spd C",
    front_spread_puts: "Front Spd P",
    double_diagonal: "Dbl Diag",
  };
  if (registryMap[setupType]) return registryMap[setupType]!;
  // Legacy fallback
  const legacyMap: Record<string, string> = {
    "Bull Put Spread":  "Bull Put Spd",
    "Call Spread":      "Call Spd",
    "Long Call":        "Long Call",
    "Covered Call":     "Cov. Call",
    "Bear Call Spread": "Bear Call Spd",
    "Bear Put Spread":  "Bear Put Spd",
    "Long Put":         "Long Put",
    "Iron Condor":      "Iron Condor",
    "Straddle":         "Straddle",
    "Calendar":         "Calendar",
    "Neutral":          "Neutral",
  };
  return legacyMap[setupType] ?? setupType;
}

const TIER_BADGE_COLOR: Record<string, string> = {
  "rookie":           "hsl(142 71% 45%)",
  "veteran":          "hsl(217 91% 60%)",
  "seasoned-veteran": "hsl(45 93% 47%)",
  "all-star":         "hsl(var(--destructive))",
};

function strategyTierFromId(setupType?: string): string | null {
  if (!setupType) return null;
  const REGISTRY_TIERS: Record<string, string> = {
    covered_call: "rookie", protective_put: "rookie", collar: "rookie", cash_secured_put: "rookie",
    long_call: "veteran", long_put: "veteran", fig_leaf: "veteran", long_call_spread: "veteran", long_put_spread: "veteran",
    short_call_spread: "seasoned-veteran", short_put_spread: "seasoned-veteran",
    long_straddle: "seasoned-veteran", long_strangle: "seasoned-veteran",
    back_spread_calls: "seasoned-veteran", back_spread_puts: "seasoned-veteran",
    long_calendar_calls: "seasoned-veteran", long_calendar_puts: "seasoned-veteran",
    diagonal_spread_calls: "seasoned-veteran", diagonal_spread_puts: "seasoned-veteran",
    long_butterfly_calls: "seasoned-veteran", long_butterfly_puts: "seasoned-veteran",
    iron_butterfly: "seasoned-veteran", skip_strike_butterfly_calls: "seasoned-veteran",
    skip_strike_butterfly_puts: "seasoned-veteran", inverse_skip_strike_butterfly_calls: "seasoned-veteran",
    inverse_skip_strike_butterfly_puts: "seasoned-veteran", christmas_tree_butterfly_calls: "seasoned-veteran",
    christmas_tree_butterfly_puts: "seasoned-veteran", long_condor_calls: "seasoned-veteran",
    long_condor_puts: "seasoned-veteran", iron_condor: "seasoned-veteran",
    short_call: "all-star", short_put: "all-star", short_straddle: "all-star", short_strangle: "all-star",
    long_combination: "all-star", short_combination: "all-star",
    front_spread_calls: "all-star", front_spread_puts: "all-star", double_diagonal: "all-star",
  };
  return REGISTRY_TIERS[setupType] ?? null;
}

export function StockListPanel({ selectedSymbol, onSelect, initialTab = "ideas" }: StockListPanelProps) {
  const [search, setSearch]           = useState("");
  const [tab, setTab]                 = useState<MainTab>(initialTab);
  const [filter, setFilter]           = useState<IdeaFilter>("all");
  const [sortKey, setSortKey]         = useState<SortKey>("opportunity");
  const [setupTypeFilter, setSetupTypeFilter] = useState<string>("");

  // Sync initialTab if it changes (e.g. navigating to /scanner?tab=watchlist)
  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const { data: stocks = [], isLoading: loadingStocks }       = useListStocks({ search, limit: 200 });
  const { data: watchlist = [], isLoading: loadingWatchlist } = useGetWatchlist();

  // Fetch full-universe stats for accurate Setups and High Conviction counts
  const { data: screenerStats } = useQuery<{ total: number; highConviction: number; bull: number; bear: number; highIv: number }>({
    queryKey: ["screener-stats-v1"],
    queryFn: () => fetch("/api/screener/stats").then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const watchlistSymbols = new Set(watchlist.map((w) => w.symbol));

  const items = useMemo(() => {
    const source: Stock[] =
      tab === "watchlist"
        ? watchlist.map((item: WatchlistItem) => ({
            ...item,
            volume: 0,
            marketCap: 0,
            sector: "Watchlist",
          }))
        : stocks;
    const q = search.trim().toLowerCase();

    let filtered = source.filter((item) => {
      if (q && !item.symbol.toLowerCase().includes(q) && !item.name.toLowerCase().includes(q)) return false;
      if (tab !== "ideas") return true;

      // Server-computed outlook for filter accuracy
      const outlook = item.recommendedOutlook;
      const ivRank  = item.ivRank ?? 0;

      if (filter === "bullish" && outlook !== "bullish") return false;
      if (filter === "bearish" && outlook !== "bearish") return false;
      if (filter === "highIv"  && ivRank < 50)           return false;
      if (filter === "etfs"    && !(item.isETF || item.etfCategory)) return false;
      if (setupTypeFilter && item.setupType !== setupTypeFilter) return false;
      return true;
    });

    filtered = [...filtered].sort((a, b) => {
      if (sortKey === "opportunity") return (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0);
      if (sortKey === "ivRank")      return (b.ivRank ?? 0) - (a.ivRank ?? 0);
      if (sortKey === "move")        return Math.abs(b.changePercent) - Math.abs(a.changePercent);
      return a.symbol.localeCompare(b.symbol);
    });

    return filtered;
  }, [filter, search, sortKey, stocks, tab, watchlist, setupTypeFilter]);

  const isLoading = tab === "watchlist" ? loadingWatchlist : loadingStocks;

  // Dynamic setup types from Ideas data
  const setupTypes = useMemo(() => {
    const types = new Set(stocks.map(s => s.setupType).filter((t): t is string => !!t));
    return [...types].sort();
  }, [stocks]);

  // Real high-conviction count from full universe (not capped by list limit)
  const highConviction = screenerStats?.highConviction ?? stocks.filter((s) => (s.opportunityScore ?? 0) >= 75).length;

  return (
    <div className="flex h-full flex-col" style={{ background: "hsl(0 0% 5%)", borderRight: "1px solid rgba(255,255,255,0.05)" }}>

      {/* Tab bar */}
      <div style={{ padding: "16px 16px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>

        {/* Search + sort cycle */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "hsl(var(--muted-foreground))", pointerEvents: "none" }} />
            <input
              type="search"
              placeholder="Search symbol…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%", padding: "7px 10px 7px 28px", fontSize: 12, borderRadius: 7,
                border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.04)",
                color: "hsl(var(--foreground))", outline: "none", letterSpacing: "-0.01em",
              }}
            />
          </div>
          <button
            onClick={() => {
              const order: SortKey[] = ["opportunity", "ivRank", "move", "symbol"];
              const next = order[(order.indexOf(sortKey) + 1) % order.length];
              setSortKey(next!);
            }}
            title={`Sort: ${sortLabels[sortKey]}`}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "0 10px", height: 32, borderRadius: 7, flexShrink: 0,
              border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.04)",
              color: "hsl(var(--muted-foreground))", cursor: "pointer", gap: 5,
              fontSize: 10, fontWeight: 500, letterSpacing: "0.02em", whiteSpace: "nowrap",
            }}
          >
            <SlidersHorizontal style={{ width: 11, height: 11 }} />
            {sortLabels[sortKey]}
          </button>
        </div>

        {/* Filter pills */}
        {tab === "ideas" && (
          <div style={{ display: "flex", gap: 4, paddingBottom: 8 }}>
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)} style={{
                flex: 1, padding: "4px 0", borderRadius: 5,
                border: filter === f.id ? "1px solid hsl(var(--primary) / 0.4)" : "1px solid rgba(255,255,255,0.06)",
                fontSize: 10, fontWeight: 500, letterSpacing: "0.02em",
                color: filter === f.id ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                background: filter === f.id ? "hsl(var(--primary) / 0.08)" : "transparent",
                cursor: "pointer", transition: "all 0.15s",
              }}>
                {f.label}
              </button>
            ))}
          </div>
        )}

        {/* Strategy type filter — ideas tab only */}
        {tab === "ideas" && setupTypes.length > 0 && (
          <div style={{ position: "relative", marginBottom: 8 }}>
            <select
              value={setupTypeFilter}
              onChange={e => setSetupTypeFilter(e.target.value)}
              style={{
                width: "100%", padding: "5px 24px 5px 10px", borderRadius: 6, fontSize: 11,
                border: setupTypeFilter ? "1px solid hsl(var(--primary) / 0.4)" : "1px solid rgba(255,255,255,0.07)",
                background: setupTypeFilter ? "hsl(var(--primary) / 0.08)" : "rgba(255,255,255,0.04)",
                color: setupTypeFilter ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                cursor: "pointer", outline: "none", appearance: "none", WebkitAppearance: "none",
              }}
            >
              <option value="">All strategies</option>
              {setupTypes.map(t => <option key={t} value={t} style={{ background: "#1c1c1e", color: "#fff" }}>{t}</option>)}
            </select>
            <ChevronDown style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", width: 11, height: 11, color: "hsl(var(--muted-foreground))", pointerEvents: "none" }} />
          </div>
        )}

        {/* Scanner summary */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 8, paddingTop: 2 }}>
          <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
            {tab === "ideas" ? "Setups" : "Watchlist"}
            {" · "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {tab === "ideas" && filter === "all" && !search && !setupTypeFilter
                ? (screenerStats?.total ?? items.length)
                : items.length}
            </span>
          </span>
          {tab === "ideas" && highConviction > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: "hsl(var(--success))", letterSpacing: "0.01em" }}>
              <Zap style={{ width: 10, height: 10 }} />
              {highConviction} high conviction
            </span>
          )}
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div style={{ padding: "6px 8px 24px" }}>
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ height: 80, borderRadius: 8, background: "rgba(255,255,255,0.035)", margin: "3px 0", animation: "pulse 1.4s infinite" }} />
            ))
          ) : items.length === 0 ? (
            <div style={{ padding: "40px 8px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
              No setups match this filter
            </div>
          ) : (
            items.map((item) => {
              const isSelected = item.symbol === selectedSymbol;
              const isUp       = item.change >= 0;
              const isWatched  = watchlistSymbols.has(item.symbol);
              const tone       = setupTone(item.recommendedOutlook);
              const score      = item.opportunityScore ?? 40;
              const ivRank     = item.ivRank ?? 0;
              const label      = shortLabel(item.setupType);
              const sColor     = scoreColor(score);
              const etfCat     = item.etfCategory;
              const isEod      = (item as any).source === "polygon-eod";
              const tier       = strategyTierFromId(item.setupType);
              const tierColor  = tier ? (TIER_BADGE_COLOR[tier] ?? "hsl(var(--muted-foreground))") : null;
              const stratDesc  = (item as any).topStrategies?.[0]?.fitReason ?? "";

              return (
                <button
                  key={item.symbol}
                  onClick={() => onSelect(item.symbol, item as Stock)}
                  style={{
                    width: "100%", display: "flex", flexDirection: "column", gap: 7,
                    padding: "10px 10px", borderRadius: 8,
                    border: isSelected ? "1px solid hsl(var(--primary) / 0.3)" : "1px solid transparent",
                    background: isSelected ? "hsl(var(--primary) / 0.07)" : "transparent",
                    cursor: "pointer", textAlign: "left", transition: "all 0.12s", marginBottom: 1,
                  }}
                  onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                >
                  {/* Row 1: symbol + setup badge | price + change */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: 13, fontWeight: 600, letterSpacing: "-0.02em",
                          color: isSelected ? "hsl(var(--primary))" : "hsl(var(--foreground))",
                        }}>
                          {item.symbol}
                        </span>
                        {isWatched && <Star style={{ width: 10, height: 10, fill: "hsl(var(--primary))", color: "hsl(var(--primary))", flexShrink: 0 }} />}
                        <span
                          title={stratDesc || label}
                          style={{
                            fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
                            textTransform: "uppercase", padding: "1.5px 5px", borderRadius: 3,
                            color: tierColor ?? (tone === "bull" ? "hsl(var(--success))" : tone === "bear" ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))"),
                            background: tierColor
                              ? `color-mix(in srgb, ${tierColor} 12%, transparent)`
                              : tone === "bull" ? "hsl(var(--success) / 0.10)" : tone === "bear" ? "hsl(var(--destructive) / 0.10)" : "rgba(255,255,255,0.05)",
                            border: tierColor ? `1px solid color-mix(in srgb, ${tierColor} 25%, transparent)` : "none",
                            flexShrink: 0,
                          }}
                        >
                          {label}
                        </span>
                        {etfCat && (
                          <span style={{
                            fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
                            padding: "1.5px 5px", borderRadius: 3, flexShrink: 0,
                            color: ETF_BADGE_COLOR[etfCat],
                            background: `color-mix(in srgb, ${ETF_BADGE_COLOR[etfCat]} 12%, transparent)`,
                            border: `1px solid color-mix(in srgb, ${ETF_BADGE_COLOR[etfCat]} 25%, transparent)`,
                          }}>
                            {ETF_BADGE_LABEL[etfCat]}
                          </span>
                        )}
                        {isEod && (
                          <span style={{
                            fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
                            padding: "1.5px 5px", borderRadius: 3, flexShrink: 0,
                            color: "hsl(38 92% 50%)",
                            background: "hsl(38 92% 50% / 0.10)",
                            border: "1px solid hsl(38 92% 50% / 0.25)",
                          }}>
                            EOD
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140, lineHeight: 1.3 }}>
                        {item.name}
                      </div>
                    </div>

                    {/* Price + change */}
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                        {formatCurrency(item.price)}
                      </div>
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2,
                        fontSize: 11, fontWeight: 500, marginTop: 2,
                        color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))",
                        fontVariantNumeric: "tabular-nums",
                      }}>
                        {isUp ? <ArrowUpRight style={{ width: 10, height: 10 }} /> : <ArrowDownRight style={{ width: 10, height: 10 }} />}
                        {formatPercent(Math.abs(item.changePercent))}
                      </div>
                    </div>
                  </div>

                  {/* Row 2: opportunity score bar + IV rank + score number */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Score bar */}
                    <div style={{ flex: 1, height: 3, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 99, width: `${score}%`,
                        background: sColor, opacity: 0.85, transition: "width 0.5s",
                      }} />
                    </div>

                    {/* IV Rank pill */}
                    <span style={{
                      fontSize: 9, fontWeight: 500, letterSpacing: "0.03em",
                      color: ivRank >= 60 ? "hsl(var(--warning, 38 92% 50%))" : ivRank >= 40 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                      background: ivRank >= 60 ? "hsl(38 92% 50% / 0.12)" : ivRank >= 40 ? "hsl(var(--primary) / 0.10)" : "rgba(255,255,255,0.05)",
                      padding: "1px 5px", borderRadius: 3, flexShrink: 0,
                    }}>
                      IV {ivRank}%
                    </span>

                    {/* Opportunity score */}
                    <span style={{
                      fontSize: 14, fontWeight: 700, letterSpacing: "-0.03em",
                      fontVariantNumeric: "tabular-nums", color: sColor, flexShrink: 0,
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
