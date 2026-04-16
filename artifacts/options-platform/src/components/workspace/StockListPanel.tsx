import { useMemo, useState, useEffect } from "react";
import { useListStocks, useGetWatchlist } from "@workspace/api-client-react";
import { ArrowDownRight, ArrowUpRight, BarChart2, Search, SlidersHorizontal, Star, Zap } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { Stock } from "@workspace/api-client-react";

interface StockListPanelProps {
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
}

type MainTab = "ideas" | "watchlist" | "portfolio";
type IdeaFilter = "all" | "bullish" | "bearish" | "highIv" | "etfs";
type SortKey = "opportunity" | "ivRank" | "move" | "symbol";

const TABS: { id: MainTab; label: string }[] = [
  { id: "ideas", label: "Ideas" },
  { id: "watchlist", label: "Watchlist" },
  { id: "portfolio", label: "Portfolio" },
];

const FILTERS: { id: IdeaFilter; label: string }[] = [
  { id: "all",     label: "All" },
  { id: "bullish", label: "Bullish" },
  { id: "bearish", label: "Bearish" },
  { id: "highIv",  label: "High IV" },
  { id: "etfs",    label: "ETFs" },
];

// ─── ETF lookup (mirrors ETF_UNIVERSE in market-data.ts) ─────────────────────
const ETF_CATEGORY: Record<string, "leveraged-bull" | "leveraged-bear" | "sector"> = {
  // Leveraged Bull
  TQQQ: "leveraged-bull", SOXL: "leveraged-bull", UPRO: "leveraged-bull",
  SPXL: "leveraged-bull", TECL: "leveraged-bull", FNGU: "leveraged-bull",
  LABU: "leveraged-bull", TNA:  "leveraged-bull", UDOW: "leveraged-bull",
  MIDU: "leveraged-bull", CURE: "leveraged-bull", DFEN: "leveraged-bull",
  DPST: "leveraged-bull", FAS:  "leveraged-bull", NAIL: "leveraged-bull",
  WANT: "leveraged-bull", BULZ: "leveraged-bull",
  // Leveraged Bear
  SQQQ: "leveraged-bear", SOXS: "leveraged-bear", SPXS: "leveraged-bear",
  SPXU: "leveraged-bear", TECS: "leveraged-bear", FNGD: "leveraged-bear",
  LABD: "leveraged-bear", TZA:  "leveraged-bear", SDOW: "leveraged-bear",
  MIDZ: "leveraged-bear", HIBS: "leveraged-bear", FAZ:  "leveraged-bear",
  SARK: "leveraged-bear",
  // Sector
  XLF: "sector", XLK: "sector", XLE: "sector", XLV: "sector", XLI: "sector",
  XLC: "sector", XLY: "sector", XLP: "sector", XLB: "sector", XLRE: "sector",
  XLU: "sector", SMH: "sector", ARKK: "sector", GDX: "sector", GDXJ: "sector",
  IBB: "sector", XBI: "sector", KRE: "sector", IYR: "sector",
};

const ETF_BADGE_LABEL: Record<string, string> = {
  "leveraged-bull": "3× Bull",
  "leveraged-bear": "3× Bear",
  "sector":         "Sector",
};

const ETF_BADGE_COLOR: Record<string, string> = {
  "leveraged-bull": "hsl(var(--success))",
  "leveraged-bear": "hsl(var(--destructive))",
  "sector":         "hsl(var(--primary))",
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

// Compact label for the setup badge (max 12 chars)
function shortLabel(setupType?: string): string {
  if (!setupType) return "Neutral";
  const map: Record<string, string> = {
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
  return map[setupType] ?? setupType;
}

export function StockListPanel({ selectedSymbol, onSelect }: StockListPanelProps) {
  const [search, setSearch]   = useState("");
  const [tab, setTab]         = useState<MainTab>("ideas");
  const [filter, setFilter]   = useState<IdeaFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("opportunity");

  const [portfolioSymbols, setPortfolioSymbols] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("portfolio") ?? "[]"); } catch { return []; }
  });

  // Re-read portfolio from localStorage when tab switches to portfolio
  useEffect(() => {
    if (tab === "portfolio") {
      try { setPortfolioSymbols(JSON.parse(localStorage.getItem("portfolio") ?? "[]")); } catch {}
    }
  }, [tab]);

  const { data: stocks = [], isLoading: loadingStocks }       = useListStocks({ search, limit: 200 });
  const { data: watchlist = [], isLoading: loadingWatchlist } = useGetWatchlist();

  const watchlistSymbols = new Set(watchlist.map((w) => w.symbol));

  const items = useMemo(() => {
    const portfolioSet = new Set(portfolioSymbols);
    const source: Stock[] =
      tab === "watchlist" ? (watchlist as Stock[]) :
      tab === "portfolio" ? stocks.filter((s) => portfolioSet.has(s.symbol)) :
      stocks;
    const q = search.trim().toLowerCase();

    let filtered = source.filter((item) => {
      if (q && !item.symbol.toLowerCase().includes(q) && !item.name.toLowerCase().includes(q)) return false;
      if (tab !== "ideas") return true;

      // Server-computed outlook for filter accuracy
      const outlook = item.recommendedOutlook;
      const ivRank  = item.ivRank ?? 0;

      if (filter === "bullish") return outlook === "bullish";
      if (filter === "bearish") return outlook === "bearish";
      if (filter === "highIv")  return ivRank >= 50;
      if (filter === "etfs")    return !!ETF_CATEGORY[item.symbol];
      return true;
    });

    filtered = [...filtered].sort((a, b) => {
      if (sortKey === "opportunity") return (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0);
      if (sortKey === "ivRank")      return (b.ivRank ?? 0) - (a.ivRank ?? 0);
      if (sortKey === "move")        return Math.abs(b.changePercent) - Math.abs(a.changePercent);
      return a.symbol.localeCompare(b.symbol);
    });

    return filtered;
  }, [filter, search, sortKey, stocks, tab, watchlist]);

  const isLoading = tab === "watchlist" ? loadingWatchlist : loadingStocks;

  // Count high-conviction opportunities (score >= 75)
  const highConviction = stocks.filter((s) => (s.opportunityScore ?? 0) >= 75).length;

  return (
    <div className="flex h-full flex-col" style={{ background: "hsl(0 0% 5%)", borderRight: "1px solid rgba(255,255,255,0.05)" }}>

      {/* Tab bar */}
      <div style={{ padding: "16px 16px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 3, marginBottom: 12 }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "5px 0", borderRadius: 6, border: "none",
              fontSize: 12, fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
              background: tab === t.id ? "rgba(255,255,255,0.09)" : "transparent",
              cursor: "pointer", transition: "all 0.15s", letterSpacing: "-0.01em",
            }}>
              {t.label}
            </button>
          ))}
        </div>

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
          <div style={{ display: "flex", gap: 4, paddingBottom: 12 }}>
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

        {/* Scanner summary */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 8, paddingTop: 2 }}>
          <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
            {tab === "ideas" ? "Setups" : tab === "watchlist" ? "Watchlist" : "Portfolio"}
            {" · "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{items.length}</span>
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
          ) : tab === "portfolio" && items.length === 0 ? (
            <div style={{ margin: "40px 8px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 12, lineHeight: 1.6 }}>
              <BarChart2 style={{ width: 26, height: 26, opacity: 0.2, margin: "0 auto 10px" }} />
              <div style={{ fontWeight: 500, marginBottom: 4 }}>No portfolio positions</div>
              <div style={{ opacity: 0.7 }}>Click <strong style={{ color: "hsl(var(--foreground))", opacity: 1 }}>+ Portfolio</strong> on any stock to track it here</div>
            </div>
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
              const etfCat     = ETF_CATEGORY[item.symbol];

              return (
                <button
                  key={item.symbol}
                  onClick={() => onSelect(item.symbol)}
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
                        <span style={{
                          fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
                          textTransform: "uppercase", padding: "1.5px 5px", borderRadius: 3,
                          color: tone === "bull" ? "hsl(var(--success))" : tone === "bear" ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))",
                          background: tone === "bull" ? "hsl(var(--success) / 0.10)" : tone === "bear" ? "hsl(var(--destructive) / 0.10)" : "rgba(255,255,255,0.05)",
                          flexShrink: 0,
                        }}>
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
