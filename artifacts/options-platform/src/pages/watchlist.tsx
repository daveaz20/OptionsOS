import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetWatchlist,
  useAddToWatchlist,
  useRemoveFromWatchlist,
  getGetWatchlistQueryKey,
} from "@workspace/api-client-react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Activity,
  Bookmark,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  LineChart,
  Plus,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCurrency, formatPercent } from "@/lib/format";

type SortKey = "symbol" | "price" | "change" | "ivRank" | "techStrength" | "score" | "addedAt";
type SortDir = "asc" | "desc";

function scoreColor(score: number): string {
  if (score >= 65) return "hsl(var(--success))";
  if (score >= 45) return "hsl(var(--primary))";
  return "hsl(var(--muted-foreground))";
}

function techColor(ts: number): string {
  if (ts >= 7) return "hsl(var(--success))";
  if (ts <= 3) return "hsl(var(--destructive))";
  return "hsl(var(--primary))";
}

function outlookColor(o?: string): string {
  if (o === "bullish") return "hsl(var(--success))";
  if (o === "bearish") return "hsl(var(--destructive))";
  return "hsl(var(--muted-foreground))";
}

function SortIcon({ col, sortKey, dir }: { col: SortKey; sortKey: SortKey; dir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown style={{ width: 11, height: 11, opacity: 0.3 }} />;
  return dir === "asc"
    ? <ChevronUp style={{ width: 11, height: 11 }} />
    : <ChevronDown style={{ width: 11, height: 11 }} />;
}

export default function WatchlistPage() {
  const { data: watchlist = [], isLoading } = useGetWatchlist();
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const isMobile = useIsMobile();

  const [search, setSearch] = useState("");
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("addedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const desktopRowTemplate = "minmax(180px, 1.7fr) minmax(200px, 1.9fr) repeat(5, minmax(90px, 0.85fr)) minmax(170px, 1.15fr)";

  function handleSort(col: SortKey) {
    if (sortKey === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else {
      setSortKey(col);
      setSortDir("desc");
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const sym = addInput.trim().toUpperCase();
    if (!sym) return;
    setAdding(true);
    try {
      await addToWatchlist.mutateAsync({ data: { symbol: sym } });
      queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
      toast({ title: `${sym} added to watchlist` });
      setAddInput("");
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? "Failed to add";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  function handleRemove(id: number, symbol: string) {
    removeFromWatchlist.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        toast({ title: `${symbol} removed` });
      },
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? watchlist.filter((w) => w.symbol.toLowerCase().includes(q) || w.name.toLowerCase().includes(q))
      : [...watchlist];

    list.sort((a, b) => {
      let av: any;
      let bv: any;
      switch (sortKey) {
        case "symbol":
          av = a.symbol;
          bv = b.symbol;
          break;
        case "price":
          av = a.price ?? 0;
          bv = b.price ?? 0;
          break;
        case "change":
          av = (a as any).changePercent ?? 0;
          bv = (b as any).changePercent ?? 0;
          break;
        case "ivRank":
          av = (a as any).ivRank ?? 0;
          bv = (b as any).ivRank ?? 0;
          break;
        case "techStrength":
          av = (a as any).technicalStrength ?? 0;
          bv = (b as any).technicalStrength ?? 0;
          break;
        case "score":
          av = (a as any).opportunityScore ?? 0;
          bv = (b as any).opportunityScore ?? 0;
          break;
        case "addedAt":
          av = a.addedAt;
          bv = b.addedAt;
          break;
        default:
          av = 0;
          bv = 0;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return list;
  }, [watchlist, search, sortKey, sortDir]);

  const gainers = watchlist.filter((w) => ((w as any).changePercent ?? 0) > 0).length;
  const losers = watchlist.filter((w) => ((w as any).changePercent ?? 0) < 0).length;
  const highIv = watchlist.filter((w) => ((w as any).ivRank ?? 0) >= 60).length;
  const avgChange = watchlist.length
    ? watchlist.reduce((sum, w) => sum + ((w as any).changePercent ?? 0), 0) / watchlist.length
    : 0;

  const renderHeaderCell = (label: string, col?: SortKey, align: "left" | "right" = "left") => {
    const active = col ? sortKey === col : false;
    return (
      <button
        type="button"
        onClick={col ? () => handleSort(col) : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: align === "right" ? "flex-end" : "flex-start",
          gap: 4,
          width: "100%",
          padding: 0,
          background: "none",
          border: "none",
          color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
          cursor: col ? "pointer" : "default",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {align === "right" && col && <SortIcon col={col} sortKey={sortKey} dir={sortDir} />}
        {label}
        {align === "left" && col && <SortIcon col={col} sortKey={sortKey} dir={sortDir} />}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "hsl(0 0% 4%)" }}>
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ padding: isMobile ? "16px 12px 80px" : "28px 28px 60px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: isMobile ? 16 : 24, gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: isMobile ? 18 : 24, fontWeight: 700, letterSpacing: "-0.03em", display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
              <Bookmark style={{ width: isMobile ? 16 : 20, height: isMobile ? 16 : 20, color: "hsl(var(--primary))" }} />
              Watchlist
            </h1>
            <p style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>
              {watchlist.length} {watchlist.length === 1 ? "stock" : "stocks"} tracked
            </p>
          </div>

          <form onSubmit={handleAdd} style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", justifyContent: isMobile ? "stretch" : "flex-end" }}>
            <input
              value={addInput}
              onChange={(e) => setAddInput(e.target.value.toUpperCase())}
              placeholder="Add ticker..."
              maxLength={8}
              spellCheck={false}
              style={{
                width: isMobile ? "100%" : 120,
                minWidth: isMobile ? 0 : 120,
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                color: "hsl(var(--foreground))",
                outline: "none",
                letterSpacing: "0.05em",
              }}
            />
            <button
              type="submit"
              disabled={!addInput.trim() || adding}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid hsl(var(--primary) / 0.4)",
                background: "hsl(var(--primary) / 0.12)",
                color: "hsl(var(--primary))",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                opacity: (!addInput.trim() || adding) ? 0.5 : 1,
                transition: "all 0.12s",
                letterSpacing: "-0.01em",
              }}
            >
              <Plus style={{ width: 14, height: 14 }} />
              {adding ? "Adding..." : "Add"}
            </button>
          </form>
        </div>

        {watchlist.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))", gap: isMobile ? 8 : 12, marginBottom: isMobile ? 16 : 22 }}>
            {[
              { label: "GAINERS", value: gainers, icon: <TrendingUp style={{ width: 14, height: 14 }} />, color: "hsl(var(--success))" },
              { label: "LOSERS", value: losers, icon: <TrendingDown style={{ width: 14, height: 14 }} />, color: "hsl(var(--destructive))" },
              { label: "AVG MOVE", value: `${avgChange >= 0 ? "+" : ""}${avgChange.toFixed(2)}%`, icon: <Activity style={{ width: 14, height: 14 }} />, color: avgChange >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))" },
              { label: "HIGH IV", value: highIv, icon: <Activity style={{ width: 14, height: 14 }} />, color: "hsl(38 92% 50%)" },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  padding: isMobile ? "10px 12px" : "14px 16px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6, color: "hsl(var(--muted-foreground))" }}>
                  {stat.icon}
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{stat.label}</span>
                </div>
                <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, letterSpacing: "-0.03em", color: stat.color, fontVariantNumeric: "tabular-nums" }}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {watchlist.length > 0 && (
          <div style={{ position: "relative", marginBottom: 14 }}>
            <Search style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "hsl(var(--muted-foreground))", pointerEvents: "none" }} />
            <input
              type="search"
              placeholder="Filter by symbol or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "9px 14px 9px 34px",
                fontSize: 13,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.04)",
                color: "hsl(var(--foreground))",
                outline: "none",
              }}
            />
          </div>
        )}

        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ height: 72, borderRadius: 10, background: "rgba(255,255,255,0.04)", animation: "pulse 1.4s infinite" }} />
            ))}
          </div>
        ) : watchlist.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 20px" }}>
            <Bookmark style={{ width: 40, height: 40, opacity: 0.12, margin: "0 auto 16px" }} />
            <p style={{ fontSize: 15, fontWeight: 500, color: "hsl(var(--muted-foreground))", marginBottom: 8 }}>Your watchlist is empty</p>
            <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", opacity: 0.6 }}>
              Add tickers using the field above, or star stocks from the Analysis page.
            </p>
          </div>
        ) : isMobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map((item) => {
              const anyItem = item as any;
              const isUp = (anyItem.changePercent ?? 0) >= 0;
              const iv = anyItem.ivRank ?? 0;
              const ts = anyItem.technicalStrength ?? 0;
              const sc = anyItem.opportunityScore ?? 0;

              return (
                <div
                  key={item.id}
                  style={{
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.07)",
                    background: "rgba(255,255,255,0.02)",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ padding: "13px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>{item.symbol}</span>
                          {anyItem.recommendedOutlook && (
                            <span style={{ fontSize: 10, fontWeight: 600, color: outlookColor(anyItem.recommendedOutlook), textTransform: "capitalize" }}>
                              {anyItem.recommendedOutlook}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{formatCurrency(item.price)}</div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3, fontSize: 12, fontWeight: 600, color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>
                          {isUp ? <ArrowUpRight style={{ width: 12, height: 12 }} /> : <ArrowDownRight style={{ width: 12, height: 12 }} />}
                          {formatPercent(Math.abs(anyItem.changePercent ?? 0))}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {iv > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4, color: iv >= 60 ? "hsl(38 92% 50%)" : "hsl(var(--muted-foreground))", background: iv >= 60 ? "hsl(38 92% 50% / 0.12)" : "rgba(255,255,255,0.05)" }}>
                          IV {Math.round(iv)}%
                        </span>
                      )}
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4, color: techColor(ts), background: `color-mix(in srgb, ${techColor(ts)} 12%, transparent)` }}>
                        TS {ts}
                      </span>
                      {sc > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, color: scoreColor(sc), background: `color-mix(in srgb, ${scoreColor(sc)} 12%, transparent)` }}>
                          Score {sc}
                        </span>
                      )}
                      <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                        <button
                          onClick={() => setLocation(`/scanner?symbol=${item.symbol}`)}
                          style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "hsl(var(--muted-foreground))", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                        >
                          <LineChart style={{ width: 11, height: 11 }} />
                          Analyze
                        </button>
                        <button
                          onClick={() => handleRemove(item.id, item.symbol)}
                          style={{ padding: "4px 8px", borderRadius: 6, border: "none", background: "transparent", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}
                          onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--destructive))"}
                          onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--muted-foreground))"}
                        >
                          <Trash2 style={{ width: 13, height: 13 }} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", overflow: "hidden", background: "rgba(255,255,255,0.02)" }}>
            <div style={{ display: "grid", gridTemplateColumns: desktopRowTemplate, gap: 16, alignItems: "center", width: "100%", padding: "12px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
              {renderHeaderCell("Symbol", "symbol")}
              {renderHeaderCell("Name")}
              {renderHeaderCell("Price", "price", "right")}
              {renderHeaderCell("Change", "change", "right")}
              {renderHeaderCell("IV Rank", "ivRank", "right")}
              {renderHeaderCell("Tech Str.", "techStrength", "right")}
              {renderHeaderCell("Score", "score", "right")}
              {renderHeaderCell("Actions", undefined, "right")}
            </div>

            <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
              {filtered.map((item, idx) => {
                const anyItem = item as any;
                const isUp = (anyItem.changePercent ?? 0) >= 0;
                const iv = anyItem.ivRank ?? 0;
                const ts = anyItem.technicalStrength ?? 0;
                const sc = anyItem.opportunityScore ?? 0;

                return (
                  <div
                    key={item.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: desktopRowTemplate,
                      gap: 16,
                      alignItems: "center",
                      width: "100%",
                      padding: "14px 18px",
                      borderBottom: idx < filtered.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                      transition: "background 0.1s",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"}
                    onMouseLeave={(e) => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
                    onClick={() => setLocation(`/scanner?symbol=${item.symbol}`)}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.02em" }}>{item.symbol}</span>
                        {anyItem.recommendedOutlook && (
                          <span style={{ fontSize: 9, fontWeight: 600, textTransform: "capitalize", color: outlookColor(anyItem.recommendedOutlook), opacity: 0.85 }}>
                            {anyItem.recommendedOutlook}
                          </span>
                        )}
                        {anyItem.setupType && (
                          <span style={{ fontSize: 9, fontWeight: 600, padding: "1.5px 5px", borderRadius: 3, color: "hsl(var(--muted-foreground))", background: "rgba(255,255,255,0.06)" }}>
                            {anyItem.setupType}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ minWidth: 0, fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{item.name}</span>
                    </div>

                    <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                      {formatCurrency(item.price)}
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 600, color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))", fontVariantNumeric: "tabular-nums" }}>
                        {isUp ? <ArrowUpRight style={{ width: 12, height: 12 }} /> : <ArrowDownRight style={{ width: 12, height: 12 }} />}
                        {formatPercent(Math.abs(anyItem.changePercent ?? 0))}
                      </span>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      {iv > 0 ? (
                        <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: iv >= 60 ? "hsl(38 92% 50%)" : iv >= 40 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>
                          {Math.round(iv)}%
                        </span>
                      ) : <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 12 }}>—</span>}
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 44, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden", display: "inline-block" }}>
                          <span style={{ display: "block", height: "100%", width: `${(ts / 10) * 100}%`, background: techColor(ts), borderRadius: 99 }} />
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: techColor(ts), fontVariantNumeric: "tabular-nums" }}>{ts}</span>
                      </span>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      {sc > 0 ? (
                        <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: scoreColor(sc) }}>{sc}</span>
                      ) : <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 12 }}>—</span>}
                    </div>

                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setLocation(`/scanner?symbol=${item.symbol}`)}
                        title="Analyze"
                        style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.04)", color: "hsl(var(--muted-foreground))", fontSize: 11, fontWeight: 500, cursor: "pointer", transition: "all 0.1s", letterSpacing: "-0.01em" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--foreground))"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.18)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--muted-foreground))"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.09)"; }}
                      >
                        <LineChart style={{ width: 11, height: 11 }} />
                        Analyze
                      </button>
                      <button
                        onClick={() => handleRemove(item.id, item.symbol)}
                        title="Remove"
                        style={{ display: "flex", alignItems: "center", padding: "5px 8px", borderRadius: 6, border: "none", background: "transparent", color: "hsl(var(--muted-foreground))", cursor: "pointer", transition: "color 0.1s" }}
                        onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--destructive))"}
                        onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--muted-foreground))"}
                      >
                        <Trash2 style={{ width: 13, height: 13 }} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {filtered.length === 0 && search && (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
                No results for "{search}"
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
