import { useDeferredValue, useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListStocks, useGetWatchlist } from "@workspace/api-client-react";
import { ArrowDownRight, ArrowUpRight, Search, SlidersHorizontal, Star, Zap } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { WatchlistItem, Stock } from "@workspace/api-client-react";
import { useSettings } from "@/contexts/SettingsContext";

interface StockListPanelProps {
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
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

const fmtCompact = (n: number): string => {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
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

function daysUntilEarnings(earningsDate?: string): number | null {
  if (!earningsDate || earningsDate === "TBD") return null;
  const date = new Date(earningsDate);
  if (Number.isNaN(date.getTime())) return null;
  const nowEt = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  nowEt.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - nowEt.getTime()) / 86_400_000);
}

function formatEarningsBadge(days: number): string {
  if (days === 0) return "Earnings today";
  if (days > 0) return `Earnings ${days}d`;
  return `Earnings ${Math.abs(days)}d ago`;
}

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

export function StockListPanel({ selectedSymbol, onSelect, initialTab = "ideas" }: StockListPanelProps) {
  const { settings } = useSettings();
  const [search, setSearch]   = useState("");
  const [tab, setTab]         = useState<MainTab>(initialTab);
  const [filter, setFilter]   = useState<IdeaFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("opportunity");
  const deferredSearch = useDeferredValue(search);

  // Sync initialTab if it changes (e.g. navigating to /analysis?tab=watchlist)
  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const { data: stocks = [], isLoading: loadingStocks } = useListStocks(
    { search: deferredSearch, limit: 200 },
    { query: { enabled: tab === "ideas" } as any },
  );
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
    const q = deferredSearch.trim().toLowerCase();

    let filtered = source.filter((item) => {
      if (q && !item.symbol.toLowerCase().includes(q) && !item.name.toLowerCase().includes(q)) return false;
      if (tab !== "ideas") return true;

      const outlook = item.recommendedOutlook;
      const ivRank  = item.ivRank ?? 0;

      if (filter === "bullish" && outlook !== "bullish") return false;
      if (filter === "bearish" && outlook !== "bearish") return false;
      if (filter === "highIv"  && ivRank < 50)           return false;
      if (filter === "etfs"    && !(item.isETF || item.etfCategory)) return false;
      return true;
    });

    filtered = [...filtered].sort((a, b) => {
      if (sortKey === "opportunity") return (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0);
      if (sortKey === "ivRank")      return (b.ivRank ?? 0) - (a.ivRank ?? 0);
      if (sortKey === "move")        return Math.abs(b.changePercent) - Math.abs(a.changePercent);
      return a.symbol.localeCompare(b.symbol);
    });

    return filtered;
  }, [deferredSearch, filter, sortKey, stocks, tab, watchlist]);

  const isLoading = tab === "watchlist" ? loadingWatchlist : loadingStocks;

  // Real high-conviction count from full universe (not capped by list limit)
  const highConviction = screenerStats?.highConviction ?? stocks.filter((s) => (s.opportunityScore ?? 0) >= 75).length;
  const columnVisibility = settings.screenerColumnVisibility;
  const isVisible = (key: keyof typeof columnVisibility) => columnVisibility[key] ?? true;
  const isCompact = settings.uiDensity === "compact";
  const rowPadding = isCompact ? "7px 9px" : "10px 10px";
  const rowGap = isCompact ? 5 : 7;

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

        {/* Scanner summary */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 8, paddingTop: 2 }}>
          <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
            {tab === "ideas" ? "Setups" : "Watchlist"}
            {" · "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {tab === "ideas" && filter === "all" && !search
                ? (screenerStats?.total ?? items.length)
                : items.length}
            </span>
          </span>
          {tab === "ideas" && highConviction > 0 && settings.showConvictionBadges && (
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
              const relVol     = Number((item as any).relVol ?? 0);
              const label      = shortLabel(item.setupType);
              const sColor     = scoreColor(score);
              const etfCat     = item.etfCategory;
              const isEod      = (item as any).source === "polygon-eod";
              const earningsDays = daysUntilEarnings((item as any).earningsDate);
              const showEarningsWarning = settings.showEarningsWarningBadge
                && earningsDays !== null
                && earningsDays >= -settings.earningsAvoidanceAfterDays
                && earningsDays <= settings.earningsAvoidanceBeforeDays;
              const showEarningsDate = settings.showEarningsDateColumnDefault && Boolean((item as any).earningsDate) && (item as any).earningsDate !== "TBD";

              return (
                <button
                  key={item.symbol}
                  onClick={() => onSelect(item.symbol)}
                  style={{
                    width: "100%", display: "flex", flexDirection: "column", gap: rowGap,
                    padding: rowPadding, borderRadius: 8,
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
                        {isVisible("symbol") && (
                          <span style={{
                            fontSize: 13, fontWeight: 600, letterSpacing: "-0.02em",
                            color: isSelected ? "hsl(var(--primary))" : "hsl(var(--foreground))",
                          }}>
                            {item.symbol}
                          </span>
                        )}
                        {isWatched && <Star style={{ width: 10, height: 10, fill: "hsl(var(--primary))", color: "hsl(var(--primary))", flexShrink: 0 }} />}
                        {settings.showConvictionBadges && (
                          <span
                            title={label}
                            style={{
                              fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
                              textTransform: "uppercase", padding: "1.5px 5px", borderRadius: 3,
                              color: tone === "bull" ? "hsl(var(--success))" : tone === "bear" ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))",
                              background: tone === "bull" ? "hsl(var(--success) / 0.10)" : tone === "bear" ? "hsl(var(--destructive) / 0.10)" : "rgba(255,255,255,0.05)",
                              flexShrink: 0,
                            }}
                          >
                            {label}
                          </span>
                        )}
                        {etfCat && settings.showSectorBadge && isVisible("sector") && (
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
                        {settings.showSectorBadge && isVisible("sector") && !etfCat && item.sector && item.sector !== "Watchlist" && (
                          <span style={{
                            fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
                            padding: "1.5px 5px", borderRadius: 3, flexShrink: 0,
                            color: "hsl(var(--primary))",
                            background: "hsl(var(--primary) / 0.10)",
                            border: "1px solid hsl(var(--primary) / 0.22)",
                          }}>
                            {item.sector}
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
                        {settings.highlightHighIvStocks && ivRank >= settings.highIvHighlightThreshold && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                            padding: "1.5px 5px", borderRadius: 3, flexShrink: 0,
                            color: "hsl(38 92% 50%)",
                            background: "hsl(38 92% 50% / 0.12)",
                            border: "1px solid hsl(38 92% 50% / 0.28)",
                          }}>
                            IV {Math.round(ivRank)}
                          </span>
                        )}
                        {showEarningsWarning && earningsDays !== null && (
                          <span
                            title={`Earnings date: ${(item as any).earningsDate}`}
                            style={{
                              fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                              padding: "1.5px 5px", borderRadius: 3, flexShrink: 0,
                              color: "hsl(38 92% 50%)",
                              background: "hsl(38 92% 50% / 0.12)",
                              border: "1px solid hsl(38 92% 50% / 0.28)",
                            }}
                          >
                            {formatEarningsBadge(earningsDays)}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140, lineHeight: 1.3 }}>
                        {item.name}
                      </div>
                    </div>

                    {/* Price + change */}
                    {(isVisible("price") || isVisible("changePercent")) && (
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        {isVisible("price") && (
                          <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                            {formatCurrency(item.price)}
                          </div>
                        )}
                        {isVisible("changePercent") && (
                          <div style={{
                            display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2,
                            fontSize: 11, fontWeight: 500, marginTop: 2,
                            color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))",
                            fontVariantNumeric: "tabular-nums",
                          }}>
                            {isUp ? <ArrowUpRight style={{ width: 10, height: 10 }} /> : <ArrowDownRight style={{ width: 10, height: 10 }} />}
                            {formatPercent(Math.abs(item.changePercent))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Row 2: opportunity score bar + IV rank + score number */}
                  {(isVisible("opportunityScore") || isVisible("volume") || isVisible("relVol") || isVisible("marketCap") || isVisible("beta") || isVisible("recommendedOutlook")) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {/* Score bar */}
                    {isVisible("opportunityScore") && <div style={{ flex: 1, minWidth: 52, height: 3, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 99, width: `${score}%`,
                        background: sColor, opacity: 0.85, transition: "width 0.5s",
                      }} />
                    </div>}

                    {/* IV Rank pill */}
                    {isVisible("relVol") && <span style={{
                      fontSize: 9, fontWeight: 500, letterSpacing: "0.03em",
                      color: relVol >= 3 ? "hsl(var(--warning, 38 92% 50%))" : relVol >= 2 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                      background: relVol >= 3 ? "hsl(38 92% 50% / 0.12)" : relVol >= 2 ? "hsl(var(--primary) / 0.10)" : "rgba(255,255,255,0.05)",
                      padding: "1px 5px", borderRadius: 3, flexShrink: 0,
                    }}>
                      RV {relVol.toFixed(2)}
                    </span>}
                    {isVisible("volume") && <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>Vol {fmtCompact((item as any).volume ?? 0)}</span>}
                    {isVisible("marketCap") && <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>Cap {fmtCompact((item as any).marketCap ?? 0)}</span>}
                    {isVisible("beta") && <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>Beta {Number((item as any).beta ?? 0).toFixed(2)}</span>}
                    {showEarningsDate && <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>Earn {(item as any).earningsDate}</span>}
                    {isVisible("recommendedOutlook") && settings.showOutlookBadge && <span style={{
                      fontSize: 9, fontWeight: 600, textTransform: "uppercase", padding: "1px 5px", borderRadius: 3,
                      color: tone === "bull" ? "hsl(var(--success))" : tone === "bear" ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))",
                      background: tone === "bull" ? "hsl(var(--success) / 0.10)" : tone === "bear" ? "hsl(var(--destructive) / 0.10)" : "rgba(255,255,255,0.05)",
                    }}>{item.recommendedOutlook ?? "neutral"}</span>}

                    {/* Opportunity score */}
                    {isVisible("opportunityScore") && <span style={{
                      fontSize: 14, fontWeight: 700, letterSpacing: "-0.03em",
                      fontVariantNumeric: "tabular-nums", color: sColor, flexShrink: 0,
                    }}>
                      {score}
                    </span>}
                  </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
