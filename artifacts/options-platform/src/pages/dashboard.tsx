import { useMemo } from "react";
import {
  useGetDashboardSummary,
  useGetTopMovers,
  useGetWatchlist,
  useListStocks,
  getGetWatchlistQueryKey,
  useRemoveFromWatchlist,
} from "@workspace/api-client-react";
import type { Stock } from "@workspace/api-client-react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  Activity, ArrowDownRight, ArrowUpRight, BookOpen, Flame,
  LayoutDashboard, Star, TrendingDown, TrendingUp, Zap,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

// ── Helpers ───────────────────────────────────────────────────────────────
const SECTORS = [
  "Technology", "Semiconductors", "Software", "Financials",
  "Healthcare", "Consumer", "Industrials", "Energy", "ETF",
];

const OUTLOOK_COLOR: Record<string, string> = {
  bullish: "hsl(var(--success))",
  bearish: "hsl(var(--destructive))",
  neutral: "hsl(var(--primary))",
};
const OUTLOOK_BG: Record<string, string> = {
  bullish: "hsl(var(--success)/0.12)",
  bearish: "hsl(var(--destructive)/0.12)",
  neutral: "hsl(var(--primary)/0.12)",
};

function ivBand(iv: number) {
  if (iv >= 80) return { label: "Very High", color: "hsl(4 90% 63%)" };
  if (iv >= 60) return { label: "High",      color: "hsl(30 95% 60%)" };
  if (iv >= 40) return { label: "Mid",        color: "hsl(var(--primary))" };
  if (iv >= 20) return { label: "Low",        color: "hsl(var(--muted-foreground))" };
  return              { label: "Very Low",   color: "hsl(var(--muted-foreground))" };
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: topMovers, isLoading: loadingMovers } = useGetTopMovers();
  const { data: watchlist = [], isLoading: loadingWatchlist } = useGetWatchlist();
  const { data: stocks = [], isLoading: loadingStocks } = useListStocks();
  const removeFromWatchlist = useRemoveFromWatchlist();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Derived data
  const topOpportunities = useMemo(() =>
    [...stocks]
      .filter(s => (s.opportunityScore ?? 0) > 0)
      .sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0))
      .slice(0, 9),
    [stocks]
  );

  const highIvStocks = useMemo(() =>
    [...stocks]
      .filter(s => (s.ivRank ?? 0) > 0)
      .sort((a, b) => (b.ivRank ?? 0) - (a.ivRank ?? 0))
      .slice(0, 8),
    [stocks]
  );

  const sectorPerf = useMemo(() => {
    const map: Record<string, { totalChange: number; count: number; setups: number }> = {};
    for (const s of stocks) {
      const sec = s.sector || "Other";
      if (!map[sec]) map[sec] = { totalChange: 0, count: 0, setups: 0 };
      map[sec].totalChange += s.changePercent;
      map[sec].count++;
      if ((s.opportunityScore ?? 0) > 55) map[sec].setups++;
    }
    return Object.entries(map)
      .map(([sector, v]) => ({ sector, avgChange: v.count > 0 ? v.totalChange / v.count : 0, count: v.count, setups: v.setups }))
      .sort((a, b) => b.avgChange - a.avgChange);
  }, [stocks]);

  const ivDistribution = useMemo(() => {
    const buckets = [
      { label: "0–20", min: 0, max: 20, count: 0 },
      { label: "20–40", min: 20, max: 40, count: 0 },
      { label: "40–60", min: 40, max: 60, count: 0 },
      { label: "60–80", min: 60, max: 80, count: 0 },
      { label: "80–100", min: 80, max: 100, count: 0 },
    ];
    for (const s of stocks) {
      const iv = s.ivRank ?? 0;
      const b = buckets.find(b => iv >= b.min && iv < b.max + 0.01);
      if (b) b.count++;
    }
    return buckets;
  }, [stocks]);

  const highConviction = stocks.filter(s => (s.opportunityScore ?? 0) >= 65).length;
  const highIvCount    = stocks.filter(s => (s.ivRank ?? 0) >= 50).length;
  const avgIvRank      = stocks.length > 0 ? Math.round(stocks.reduce((s, x) => s + (x.ivRank ?? 0), 0) / stocks.length) : 0;
  const liveBullish    = stocks.filter(s => s.changePercent > 0).length;
  const liveBearish    = stocks.filter(s => s.changePercent < 0).length;
  const liveNeutral    = stocks.filter(s => s.changePercent === 0).length;
  const liveSentiment  = liveBullish > liveBearish ? "bullish" : liveBearish > liveBullish ? "bearish" : "neutral";

  const now  = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <ScrollArea className="h-full w-full" style={{ background: "hsl(0 0% 4%)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 28px 60px" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <LayoutDashboard style={{ width: 22, height: 22, color: "hsl(var(--primary))" }} />
              Market Dashboard
            </h1>
            <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>{dateStr}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 99, background: "hsl(var(--success)/0.1)", border: "1px solid hsl(var(--success)/0.2)" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "hsl(var(--success))", boxShadow: "0 0 6px hsl(var(--success))" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "hsl(var(--success))" }}>Market Open</span>
          </div>
        </div>

        {/* ── Stats Row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10, marginBottom: 28 }}>
          <StatCard
            label="Sentiment"
            icon={<Activity style={{ width: 13, height: 13 }} />}
            loading={loadingStocks}
            value={<span style={{ color: OUTLOOK_COLOR[liveSentiment], textTransform: "capitalize" }}>{liveSentiment}</span>}
            sub={`${stocks.length} stocks`}
          />
          <StatCard label="Tracked" icon={<BookOpen style={{ width: 13, height: 13 }} />} loading={loadingStocks}
            value={stocks.length} sub="in universe" />
          <StatCard label="Setups found" icon={<Zap style={{ width: 13, height: 13 }} />} loading={loadingStocks}
            value={<span style={{ color: "hsl(var(--success))" }}>{highConviction}</span>} sub="high conviction" />
          <StatCard label="High IV stocks" icon={<Flame style={{ width: 13, height: 13 }} />} loading={loadingStocks}
            value={<span style={{ color: "hsl(30 95% 60%)" }}>{highIvCount}</span>} sub="IV rank ≥ 50" />
          <StatCard label="Avg IV rank" icon={<Activity style={{ width: 13, height: 13 }} />} loading={loadingStocks}
            value={`${avgIvRank}%`} sub="across universe" />
          <StatCard label="Breadth" icon={<TrendingUp style={{ width: 13, height: 13 }} />} loading={loadingStocks}
            value={
              <div style={{ display: "flex", alignItems: "baseline", gap: 5, fontSize: 15 }}>
                <span style={{ color: "hsl(var(--success))" }}>{liveBullish}</span>
                <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 11 }}>·</span>
                <span style={{ color: "hsl(var(--muted-foreground))" }}>{liveNeutral}</span>
                <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 11 }}>·</span>
                <span style={{ color: "hsl(var(--destructive))" }}>{liveBearish}</span>
              </div>
            }
            sub="bull · neutral · bear"
          />
        </div>

        {/* ── Top Opportunities ── */}
        <Section title="Top Opportunities" sub="Highest-scoring setups from the scanner" icon={<Zap style={{ width: 14, height: 14, color: "hsl(var(--primary))" }} />}>
          {loadingStocks ? (
            <SkeletonGrid count={9} h={88} cols={3} />
          ) : topOpportunities.length === 0 ? (
            <EmptyState label="No setups found" />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
              {topOpportunities.map(s => <OpportunityCard key={s.id} stock={s} />)}
            </div>
          )}
        </Section>

        {/* ── Sector Heatmap + IV Leaders ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>

          <Section title="Sector Performance" sub="Avg daily change by sector" icon={<BarChart style={{ width: 14, height: 14, color: "hsl(var(--primary))" }} />} noPad>
            {loadingStocks ? <div style={{ padding: 16 }}><SkeletonGrid count={8} h={36} cols={2} /></div> : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, padding: 1 }}>
                {sectorPerf.map(s => {
                  const isUp = s.avgChange >= 0;
                  const intensity = Math.min(Math.abs(s.avgChange) / 3, 1);
                  const bg = isUp ? `hsl(142 76% 52% / ${0.05 + intensity * 0.15})` : `hsl(4 90% 63% / ${0.05 + intensity * 0.15})`;
                  return (
                    <div key={s.sector} style={{ padding: "11px 14px", background: bg, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "-0.01em" }}>{s.sector}</div>
                        <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>{s.count} stocks · {s.setups} setups</div>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>
                        {isUp ? "+" : ""}{s.avgChange.toFixed(2)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title="Volatility Leaders" sub="Highest IV rank — premium selling candidates" icon={<Flame style={{ width: 14, height: 14, color: "hsl(30 95% 60%)" }} />} noPad>
            {loadingStocks ? <div style={{ padding: 16 }}><SkeletonGrid count={8} h={44} cols={1} /></div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {highIvStocks.map((s, i) => {
                  const band = ivBand(s.ivRank ?? 0);
                  const isUp = s.changePercent >= 0;
                  return (
                    <Link key={s.id} href={`/?symbol=${s.symbol}`}>
                      <div style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "11px 16px",
                        borderBottom: i < highIvStocks.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                        transition: "background 0.1s", cursor: "pointer",
                      }}
                        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"}
                        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
                      >
                        <span style={{ fontSize: 10, fontWeight: 700, width: 16, color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>{i + 1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "-0.02em" }}>{s.symbol}</span>
                            <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 3, background: `${band.color}22`, color: band.color }}>{band.label} IV</span>
                          </div>
                          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1, letterSpacing: "-0.01em" }}>
                            {s.setupType ?? "Neutral"} · {s.sector}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.03em", color: band.color, fontVariantNumeric: "tabular-nums" }}>
                            {Math.round(s.ivRank ?? 0)}%
                          </div>
                          <div style={{ fontSize: 10, color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))", fontVariantNumeric: "tabular-nums", marginTop: 1 }}>
                            {isUp ? "+" : ""}{s.changePercent.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </Section>
        </div>

        {/* ── IV Distribution + Movers ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>

          <Section title="IV Rank Distribution" sub="Universe spread across volatility buckets" icon={<Activity style={{ width: 14, height: 14, color: "hsl(var(--primary))" }} />}>
            {loadingStocks ? <div style={{ height: 180, borderRadius: 6, background: "rgba(255,255,255,0.03)", animation: "pulse 1.4s infinite" }} /> : (
              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ivDistribution} barCategoryGap={6}>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <RechartsTooltip
                      cursor={{ fill: "rgba(255,255,255,0.04)" }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0]!.payload;
                        return (
                          <div style={{ background: "hsl(0 0% 10%)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "6px 10px", fontSize: 11 }}>
                            <div style={{ fontWeight: 600, marginBottom: 2 }}>IV {d.label}</div>
                            <div style={{ color: "hsl(var(--muted-foreground))" }}>{d.count} stocks</div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {ivDistribution.map((b, i) => (
                        <Cell key={i} fill={
                          i === 4 ? "hsl(4 90% 63%)" :
                          i === 3 ? "hsl(30 95% 60%)" :
                          i === 2 ? "hsl(var(--primary))" :
                          "rgba(255,255,255,0.18)"
                        } />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Section>

          <Section title="Top Gainers" sub="" icon={<TrendingUp style={{ width: 14, height: 14, color: "hsl(var(--success))" }} />} noPad>
            {loadingMovers ? <div style={{ padding: 12 }}><SkeletonGrid count={5} h={36} cols={1} /></div> : (
              <div>
                {(topMovers?.gainers ?? []).map((s, i) => (
                  <MoverRowCompact key={s.id} stock={s} type="gainer" rank={i + 1} />
                ))}
              </div>
            )}
          </Section>

          <Section title="Top Losers" sub="" icon={<TrendingDown style={{ width: 14, height: 14, color: "hsl(var(--destructive))" }} />} noPad>
            {loadingMovers ? <div style={{ padding: 12 }}><SkeletonGrid count={5} h={36} cols={1} /></div> : (
              <div>
                {(topMovers?.losers ?? []).map((s, i) => (
                  <MoverRowCompact key={s.id} stock={s} type="loser" rank={i + 1} />
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* ── Watchlist ── */}
        <Section title="Watchlist" sub="Your tracked assets" icon={<Star style={{ width: 14, height: 14, color: "hsl(var(--primary))" }} />} noPad>
          {loadingWatchlist ? (
            <div style={{ padding: 12 }}><SkeletonGrid count={4} h={52} cols={4} /></div>
          ) : watchlist.length === 0 ? (
            <div style={{ padding: "40px 24px", textAlign: "center" }}>
              <Star style={{ width: 30, height: 30, opacity: 0.15, margin: "0 auto 10px" }} />
              <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>No stocks in your watchlist yet.</p>
              <Link href="/">
                <button style={{ marginTop: 12, padding: "7px 18px", borderRadius: 99, fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "hsl(var(--foreground))", cursor: "pointer" }}>
                  Go to Workspace
                </button>
              </Link>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 1 }}>
              {watchlist.map(item => {
                const isUp = item.changePercent >= 0;
                const iv = (item as any).ivRank as number | undefined;
                const score = (item as any).opportunityScore as number | undefined;
                return (
                  <div key={item.id}
                    style={{ padding: "14px 16px", borderRight: "1px solid rgba(255,255,255,0.04)", display: "flex", flexDirection: "column", gap: 8, transition: "background 0.1s", cursor: "pointer" }}
                    onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"}
                    onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <Link href={`/?symbol=${item.symbol}`}>
                          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.02em" }}>{item.symbol}</span>
                        </Link>
                        <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 2, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(item.price)}</div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2, marginTop: 1 }}>
                          {isUp ? <ArrowUpRight style={{ width: 11, height: 11 }} /> : <ArrowDownRight style={{ width: 11, height: 11 }} />}
                          {formatPercent(item.changePercent)}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                      <Pill label={`TS: ${item.technicalStrength}`} color={item.technicalStrength >= 7 ? "hsl(var(--success))" : item.technicalStrength <= 3 ? "hsl(var(--destructive))" : "hsl(var(--primary))"} />
                      {iv != null && iv > 0 && <Pill label={`IV ${Math.round(iv)}%`} color={iv >= 60 ? "hsl(30 95% 60%)" : "hsl(var(--muted-foreground))"} />}
                      <button
                        onClick={() => {
                          removeFromWatchlist.mutate({ id: item.id }, {
                            onSuccess: () => {
                              queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
                              toast({ title: "Removed", description: `${item.symbol} removed from watchlist.` });
                            },
                          });
                        }}
                        style={{ marginLeft: "auto", fontSize: 10, color: "hsl(var(--muted-foreground))", padding: "2px 6px", borderRadius: 4, border: "none", background: "transparent", cursor: "pointer", opacity: 0.6 }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--destructive))"; (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--muted-foreground))"; (e.currentTarget as HTMLButtonElement).style.opacity = "0.6"; }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </ScrollArea>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function Section({ title, sub, icon, children, noPad }: { title: string; sub: string; icon: React.ReactNode; children: React.ReactNode; noPad?: boolean }) {
  return (
    <div style={{ marginBottom: 20, borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", overflow: "hidden" }}>
      <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", gap: 7 }}>
        {icon}
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.02em" }}>{title}</span>
          {sub && <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginLeft: 8 }}>{sub}</span>}
        </div>
      </div>
      <div style={noPad ? {} : { padding: "14px 16px" }}>
        {children}
      </div>
    </div>
  );
}

function StatCard({ label, icon, loading, value, sub }: { label: string; icon: React.ReactNode; loading: boolean; value: React.ReactNode; sub: string }) {
  return (
    <div style={{ padding: "14px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, color: "hsl(var(--muted-foreground))", marginBottom: 8 }}>
        {icon}
        <span style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.02em" }}>{label.toUpperCase()}</span>
      </div>
      {loading ? (
        <div style={{ height: 24, borderRadius: 4, background: "rgba(255,255,255,0.06)", animation: "pulse 1.4s infinite", marginBottom: 4 }} />
      ) : (
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", marginBottom: 3 }}>{value}</div>
      )}
      <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>{sub}</div>
    </div>
  );
}

function OpportunityCard({ stock }: { stock: Stock }) {
  const score = stock.opportunityScore ?? 0;
  const outlook = stock.recommendedOutlook ?? "neutral";
  const isUp = stock.changePercent >= 0;
  const scoreColor = score >= 70 ? "hsl(var(--success))" : score >= 50 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))";

  return (
    <Link href={`/?symbol=${stock.symbol}`}>
      <div
        style={{
          padding: "13px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,255,255,0.02)", cursor: "pointer", transition: "all 0.12s",
        }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.background = "rgba(255,255,255,0.045)"; el.style.borderColor = "rgba(255,255,255,0.12)"; }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.background = "rgba(255,255,255,0.02)"; el.style.borderColor = "rgba(255,255,255,0.07)"; }}
      >
        {/* Top */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 9 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>{stock.symbol}</div>
            <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stock.name}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em", color: scoreColor, fontVariantNumeric: "tabular-nums" }}>{score}</div>
            <div style={{ width: 36, height: 2, borderRadius: 99, background: "rgba(255,255,255,0.08)", overflow: "hidden", marginTop: 3, marginLeft: "auto" }}>
              <div style={{ height: "100%", width: `${(score / 100) * 100}%`, background: scoreColor, borderRadius: 99 }} />
            </div>
          </div>
        </div>

        {/* Tags */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 9 }}>
          <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 5px", borderRadius: 3, background: OUTLOOK_BG[outlook], color: OUTLOOK_COLOR[outlook], letterSpacing: "0.02em", textTransform: "uppercase" }}>
            {outlook}
          </span>
          {stock.setupType && (
            <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 5px", borderRadius: 3, background: "rgba(255,255,255,0.07)", color: "hsl(var(--muted-foreground))", letterSpacing: "0.02em" }}>
              {stock.setupType}
            </span>
          )}
        </div>

        {/* Metrics */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <div>
            <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>Price</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatCurrency(stock.price)}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>Change</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))", fontVariantNumeric: "tabular-nums" }}>
              {isUp ? "+" : ""}{stock.changePercent.toFixed(2)}%
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>IV Rank</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: ivBand(stock.ivRank ?? 0).color, fontVariantNumeric: "tabular-nums" }}>
              {Math.round(stock.ivRank ?? 0)}%
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function MoverRowCompact({ stock, type, rank }: { stock: Stock; type: "gainer" | "loser"; rank: number }) {
  const isUp = type === "gainer";
  return (
    <Link href={`/?symbol=${stock.symbol}`}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer", transition: "background 0.1s" }}
        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"}
        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", width: 14, textAlign: "right", flexShrink: 0 }}>{rank}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "-0.02em" }}>{stock.symbol}</div>
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatCurrency(stock.price)}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))", display: "flex", alignItems: "center", gap: 2, fontVariantNumeric: "tabular-nums" }}>
            {isUp ? <ArrowUpRight style={{ width: 11, height: 11 }} /> : <ArrowDownRight style={{ width: 11, height: 11 }} />}
            {isUp ? "+" : ""}{stock.changePercent.toFixed(2)}%
          </div>
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>
            {formatNumber(stock.volume)}
          </div>
        </div>
      </div>
    </Link>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 9.5, fontWeight: 600, padding: "2px 5px", borderRadius: 3, background: `${color}18`, color, letterSpacing: "0.01em" }}>
      {label}
    </span>
  );
}

function SkeletonGrid({ count, h, cols }: { count: number; h: number; cols: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},1fr)`, gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ height: h, borderRadius: 6, background: "rgba(255,255,255,0.04)", animation: "pulse 1.4s infinite" }} />
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ padding: "40px 0", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
      {label}
    </div>
  );
}
