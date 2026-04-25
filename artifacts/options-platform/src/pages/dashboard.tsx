import { useMemo, useState, useCallback, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery } from "@tanstack/react-query";
import {
  useGetDashboardSummary, useGetTopMovers, useGetWatchlist,
  useListStocks, getGetWatchlistQueryKey, useRemoveFromWatchlist,
  useGetAccountSummary,
  useGetTastytradeAuthStatus,
} from "@workspace/api-client-react";
import type { Stock } from "@workspace/api-client-react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  Activity, ArrowDownRight, ArrowUpRight, ArrowUp, ArrowDown,
  BookOpen, Briefcase, ChevronDown, ChevronUp, CheckCircle2,
  Circle, Flame, LayoutDashboard, LayoutGrid, Pencil, Star,
  TrendingDown, TrendingUp, Volume2, Zap, X, Calendar, Bell,
  BarChart2, Wallet,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useSettings } from "@/contexts/SettingsContext";

// ── Module Registry ───────────────────────────────────────────────────────
export interface ModuleDef {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  cols: 12 | 6 | 4;       // out of 12-column grid
  defaultEnabled: boolean;
  category: "market" | "analysis" | "personal";
}

const MODULE_REGISTRY: ModuleDef[] = [
  { id: "account_summary",  title: "Account",             description: "Tastytrade account: net liq, buying power, P&L, theta",   icon: <Wallet style={{ width: 13, height: 13 }} />,       cols: 12, defaultEnabled: true,  category: "personal" },
  { id: "stats",            title: "Market Stats",        description: "Live overview: sentiment, setups, IV rank, breadth",      icon: <Activity style={{ width: 13, height: 13 }} />,    cols: 12, defaultEnabled: true,  category: "market"   },
  { id: "opportunities",    title: "Top Opportunities",   description: "Highest-scoring setups from the scanner",                  icon: <Zap style={{ width: 13, height: 13 }} />,          cols: 12, defaultEnabled: true,  category: "analysis" },
  { id: "sector_perf",      title: "Sector Performance",  description: "Average daily change by sector",                           icon: <BarChart2 style={{ width: 13, height: 13 }} />,    cols: 6,  defaultEnabled: true,  category: "market"   },
  { id: "vol_leaders",      title: "Volatility Leaders",  description: "Highest IV rank — premium selling candidates",             icon: <Flame style={{ width: 13, height: 13 }} />,        cols: 6,  defaultEnabled: true,  category: "analysis" },
  { id: "iv_distribution",  title: "IV Distribution",     description: "Universe spread across volatility percentile buckets",     icon: <Activity style={{ width: 13, height: 13 }} />,     cols: 4,  defaultEnabled: true,  category: "market"   },
  { id: "gainers",          title: "Top Gainers",         description: "Best performing stocks today",                             icon: <TrendingUp style={{ width: 13, height: 13 }} />,   cols: 4,  defaultEnabled: true,  category: "market"   },
  { id: "losers",           title: "Top Losers",          description: "Worst performing stocks today",                            icon: <TrendingDown style={{ width: 13, height: 13 }} />, cols: 4,  defaultEnabled: true,  category: "market"   },
  { id: "watchlist",        title: "Watchlist",           description: "Your tracked assets with IV rank and opportunity score",   icon: <Star style={{ width: 13, height: 13 }} />,         cols: 12, defaultEnabled: true,  category: "personal" },
  { id: "technical_alerts", title: "Technical Alerts",    description: "RSI overbought / oversold signals across the universe",    icon: <Bell style={{ width: 13, height: 13 }} />,         cols: 6,  defaultEnabled: false, category: "analysis" },
  { id: "covered_calls",    title: "Covered Call Ideas",  description: "High-IV bullish stocks ideal for selling calls",           icon: <Briefcase style={{ width: 13, height: 13 }} />,    cols: 6,  defaultEnabled: false, category: "analysis" },
  { id: "most_active",      title: "Most Active",         description: "Highest trading volume today",                             icon: <Volume2 style={{ width: 13, height: 13 }} />,      cols: 6,  defaultEnabled: false, category: "market"   },
  { id: "week52",           title: "52-Week Extremes",    description: "Stocks near 52-week highs and lows",                       icon: <ChevronUp style={{ width: 13, height: 13 }} />,    cols: 6,  defaultEnabled: false, category: "market"   },
  { id: "earnings",         title: "Earnings Watch",      description: "Upcoming earnings dates with IV rank",                     icon: <Calendar style={{ width: 13, height: 13 }} />,     cols: 6,  defaultEnabled: false, category: "analysis" },
  { id: "portfolio",        title: "Portfolio",           description: "Your saved portfolio positions",                            icon: <Briefcase style={{ width: 13, height: 13 }} />,    cols: 12, defaultEnabled: false, category: "personal" },
];

const DEFAULT_ORDER = MODULE_REGISTRY.map(m => m.id);
const DEFAULT_ENABLED = MODULE_REGISTRY.filter(m => m.defaultEnabled).map(m => m.id);

// ── localStorage persistence ──────────────────────────────────────────────
const LS_KEY = "dashboard_v2";
interface DashboardConfig { order: string[]; enabled: string[] }

function loadConfig(): DashboardConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { order: DEFAULT_ORDER, enabled: DEFAULT_ENABLED };
}
function saveConfig(cfg: DashboardConfig) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────
const OUTLOOK_COLOR: Record<string, string> = {
  bullish: "hsl(var(--success))", bearish: "hsl(var(--destructive))", neutral: "hsl(var(--primary))",
};
const OUTLOOK_BG: Record<string, string> = {
  bullish: "hsl(var(--success)/0.12)", bearish: "hsl(var(--destructive)/0.12)", neutral: "hsl(var(--primary)/0.12)",
};

function ivBand(iv: number) {
  if (iv >= 80) return { label: "Very High IV", color: "hsl(4 90% 63%)" };
  if (iv >= 60) return { label: "High IV",      color: "hsl(30 95% 60%)" };
  if (iv >= 40) return { label: "Mid IV",        color: "hsl(var(--primary))" };
  return              { label: "Low IV",         color: "hsl(var(--muted-foreground))" };
}

function daysUntil(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

// ── Shared sub-components ─────────────────────────────────────────────────
function Section({ title, sub, icon, children, noPad, action }: {
  title: string; sub?: string; icon: React.ReactNode;
  children: React.ReactNode; noPad?: boolean; action?: React.ReactNode;
}) {
  return (
    <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", overflow: "hidden", height: "100%" }}>
      <div style={{ padding: "13px 16px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {icon}
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em" }}>{title}</span>
          {sub && <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginLeft: 4 }}>{sub}</span>}
        </div>
        {action}
      </div>
      <div style={noPad ? {} : { padding: "14px 16px" }}>{children}</div>
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return <span style={{ fontSize: 9.5, fontWeight: 600, padding: "2px 5px", borderRadius: 3, background: `${color}18`, color, letterSpacing: "0.01em" }}>{label}</span>;
}

function Skeleton({ h = 44, cols = 1 }: { h?: number; cols?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},1fr)`, gap: 8 }}>
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} style={{ height: h, borderRadius: 6, background: "rgba(255,255,255,0.04)", animation: "pulse 1.4s infinite" }} />
      ))}
    </div>
  );
}

// ── Market status pill ────────────────────────────────────────────────────

function useMarketOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function check() {
      try {
        const etStr = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
        const et = new Date(etStr);
        const day = et.getDay();
        if (day === 0 || day === 6) { setOpen(false); return; }
        const totalMin = et.getHours() * 60 + et.getMinutes();
        setOpen(totalMin >= 9 * 60 + 30 && totalMin < 16 * 60);
      } catch { setOpen(false); }
    }
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);
  return open;
}

function MarketStatusPill() {
  const open = useMarketOpen();
  if (!open) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 99,
      background: "hsl(var(--success)/0.1)", border: "1px solid hsl(var(--success)/0.2)" }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "hsl(var(--success))",
        boxShadow: "0 0 6px hsl(var(--success))" }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--success))" }}>Market Open</span>
    </div>
  );
}

// ── Account Summary Module ────────────────────────────────────────────────

function AccountSummaryModule() {
  const { data, isLoading, error } = useGetAccountSummary();
  const isMobile = useIsMobile();
  const { data: authStatus } = useGetTastytradeAuthStatus();
  const { settings, maskSensitiveValue } = useSettings();

  if (error) {
    const status = (error as any)?.status;
    const isUnauthorized = status === 401;
    const isUnavailable = status === 503;
    return (
      <div style={{ padding: "18px 20px", color: "hsl(var(--muted-foreground))", fontSize: 12 }}>
        {isUnauthorized
          ? "Tastytrade is not connected yet. Connect your account to load balances and positions."
          : isUnavailable && authStatus?.enabled
            ? "Tastytrade is ready to connect, but no account is linked yet."
            : isUnavailable
              ? "Tastytrade OAuth credentials are not configured on the server."
              : `Account unavailable: ${(error as Error).message}`}
      </div>
    );
  }

  const stats = [
    {
      label: "NET LIQUIDATING VALUE",
      value: isLoading ? null : maskSensitiveValue(`$${(data?.netLiquidatingValue ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "balance"),
      color: undefined,
    },
    {
      label: "OPTION BUYING POWER",
      value: isLoading ? null : maskSensitiveValue(`$${(data?.optionBuyingPower ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "buyingPower"),
      color: undefined,
      hide: settings.hideBuyingPowerDisplay,
    },
    {
      label: "TODAY'S P&L",
      value: isLoading ? null : (data?.dayPnl !== undefined
        ? maskSensitiveValue(`${data.dayPnl >= 0 ? "+" : ""}$${Math.abs(data.dayPnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "pnl")
        : "—"),
      color: data?.dayPnl !== undefined
        ? (data.dayPnl >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))")
        : undefined,
    },
    {
      label: "OPEN POSITIONS",
      value: isLoading ? null : String(data?.openPositionsCount ?? 0),
      color: undefined,
      link: "/positions",
    },
    {
      label: "PORTFOLIO THETA",
      value: isLoading ? null : (data?.portfolioTheta !== undefined
        ? maskSensitiveValue(`${data.portfolioTheta >= 0 ? "+" : ""}$${Math.abs(data.portfolioTheta).toFixed(2)}/d`, "pnl")
        : "—"),
      color: data?.portfolioTheta !== undefined
        ? (data.portfolioTheta < 0 ? "hsl(var(--destructive))" : "hsl(var(--success))")
        : undefined,
    },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(5,1fr)", gap: 10 }}>
      {stats.filter((s) => !s.hide).map((s, i) => (
        <div key={i} style={{ padding: "13px 14px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
          <div style={{ fontSize: 9.5, letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", marginBottom: 7, fontWeight: 500 }}>{s.label}</div>
          {isLoading
            ? <div style={{ height: 26, borderRadius: 4, background: "rgba(255,255,255,0.06)", animation: "pulse 1.4s infinite", marginBottom: 4 }} />
            : s.link
              ? <Link href={s.link}><div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", marginBottom: 3, color: s.color ?? "hsl(var(--foreground))", cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(255,255,255,0.2)" }}>{s.value}</div></Link>
              : <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", marginBottom: 3, color: s.color ?? "hsl(var(--foreground))" }}>{s.value}</div>
          }
        </div>
      ))}
    </div>
  );
}

// ── Market stats hook (full-universe, accurate) ────────────────────────────

interface MarketStats {
  total: number; bull: number; bear: number; neutral: number;
  breadth: number; highConviction: number; technicalsCount: number;
  highIv: number; avgIv: number; bestScore: number; setups60: number; marketOpen: boolean;
  source: string; cachedAt: number;
}

function useMarketStats() {
  return useQuery<MarketStats>({
    queryKey: ["screener-stats"],
    queryFn: async () => {
      const res = await fetch("/api/screener/stats");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });
}

// ── Module components ─────────────────────────────────────────────────────

function StatsModule({ stocks: _stocks, loadingStocks: _loadingStocks }: { stocks: Stock[]; loadingStocks: boolean }) {
  const { data: mkt, isLoading: loadingStats } = useMarketStats();
  const loading = loadingStats;
  const isMobile = useIsMobile();

  const bull    = mkt?.bull    ?? 0;
  const bear    = mkt?.bear    ?? 0;
  const neutral = mkt?.neutral ?? 0;
  const total   = mkt?.total   ?? 0;
  const breadth = mkt?.breadth ?? 50;

  const breadthColor = breadth >= 60 ? "hsl(var(--success))" : breadth <= 40 ? "hsl(var(--destructive))" : "hsl(var(--primary))";
  const breadthLabel = breadth >= 60 ? "Advancing" : breadth <= 40 ? "Declining" : "Mixed";

  const stats = [
    {
      label: "BREADTH",
      value: <span style={{ color: breadthColor }}>{breadthLabel}</span>,
      sub: `${breadth}% advancing · ${total.toLocaleString()} stocks`,
    },
    {
      label: "UNIVERSE",
      value: total.toLocaleString(),
      sub: `${mkt?.technicalsCount ?? 0} fully scored`,
    },
    {
      label: "SETUPS FOUND",
      value: <span style={{ color: "hsl(var(--success))" }}>{mkt?.highConviction ?? 0}</span>,
      sub: `high conviction ≥ 75 · of ${mkt?.technicalsCount ?? 0} scored`,
    },
    {
      label: "HIGH IV",
      value: <span style={{ color: "hsl(30 95% 60%)" }}>{mkt?.highIv ?? 0}</span>,
      sub: "IV rank ≥ 50",
    },
    {
      label: "AVG IV RANK",
      value: `${mkt?.avgIv ?? 0}%`,
      sub: "across scored universe",
    },
    {
      label: "ACTIONABLE SETUPS",
      value: <span style={{ color: "hsl(var(--success))" }}>{mkt?.setups60 ?? 0}</span>,
      sub: "opportunity score ≥ 60",
    },
    {
      label: "ADVANCES / DECLINES",
      value: <span style={{ fontSize: 16, display: "flex", gap: 5, alignItems: "baseline" }}>
        <span style={{ color: "hsl(var(--success))" }}>{bull}</span>
        <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 11 }}>·</span>
        <span style={{ color: "hsl(var(--muted-foreground))" }}>{neutral}</span>
        <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 11 }}>·</span>
        <span style={{ color: "hsl(var(--destructive))" }}>{bear}</span>
      </span>,
      sub: "up · flat · down",
    },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 10 }}>
      {stats.map((s, i) => (
        <div key={i} style={{ padding: "13px 14px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
          <div style={{ fontSize: 9.5, letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", marginBottom: 7, fontWeight: 500 }}>{s.label}</div>
          {loading
            ? <div style={{ height: 26, borderRadius: 4, background: "rgba(255,255,255,0.06)", animation: "pulse 1.4s infinite", marginBottom: 4 }} />
            : <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", marginBottom: 3 }}>{s.value}</div>
          }
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>{s.sub}</div>
        </div>
      ))}
    </div>
  );
}

function OpportunitiesModule({ stocks, loading }: { stocks: Stock[]; loading: boolean }) {
  const isMobile = useIsMobile();
  const top = useMemo(() =>
    [...stocks].filter(s => (s.opportunityScore ?? 0) > 0)
      .sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0)).slice(0, 9),
    [stocks]);

  const cols = isMobile ? "1fr" : "repeat(3,1fr)";
  if (loading) return <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10 }}>{Array.from({ length: isMobile ? 3 : 9 }).map((_, i) => <div key={i} style={{ height: 110, borderRadius: 8, background: "rgba(255,255,255,0.04)", animation: "pulse 1.4s infinite" }} />)}</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10 }}>
      {top.map(s => <OpportunityCard key={s.id} stock={s} />)}
    </div>
  );
}

function OpportunityCard({ stock }: { stock: Stock }) {
  const score = stock.opportunityScore ?? 0;
  const outlook = stock.recommendedOutlook ?? "neutral";
  const isUp = stock.changePercent >= 0;
  const scoreColor = score >= 70 ? "hsl(var(--success))" : score >= 50 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))";
  return (
    <Link href={`/scanner?symbol=${stock.symbol}`}>
      <div style={{ padding: "13px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", cursor: "pointer", transition: "all 0.12s" }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.background = "rgba(255,255,255,0.045)"; el.style.borderColor = "rgba(255,255,255,0.12)"; }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.background = "rgba(255,255,255,0.02)"; el.style.borderColor = "rgba(255,255,255,0.07)"; }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>{stock.symbol}</div>
            <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stock.name}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em", color: scoreColor, fontVariantNumeric: "tabular-nums" }}>{score}</div>
            <div style={{ width: 36, height: 2, borderRadius: 99, background: "rgba(255,255,255,0.08)", overflow: "hidden", marginTop: 3, marginLeft: "auto" }}>
              <div style={{ height: "100%", width: `${Math.min(100, score)}%`, background: scoreColor, borderRadius: 99 }} />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 5px", borderRadius: 3, background: OUTLOOK_BG[outlook], color: OUTLOOK_COLOR[outlook], letterSpacing: "0.02em", textTransform: "uppercase" }}>{outlook}</span>
          {stock.setupType && <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 5px", borderRadius: 3, background: "rgba(255,255,255,0.07)", color: "hsl(var(--muted-foreground))", letterSpacing: "0.02em" }}>{stock.setupType}</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          {[
            { label: "Price", value: formatCurrency(stock.price), color: undefined },
            { label: "Change", value: `${isUp ? "+" : ""}${stock.changePercent.toFixed(2)}%`, color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))" },
            { label: "IV Rank", value: `${Math.round(stock.ivRank ?? 0)}%`, color: ivBand(stock.ivRank ?? 0).color },
          ].map((m, i) => (
            <div key={i}>
              <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>{m.label}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: m.color, fontVariantNumeric: "tabular-nums" }}>{m.value}</div>
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}

function SectorPerfModule({ stocks, loading }: { stocks: Stock[]; loading: boolean }) {
  const sectorPerf = useMemo(() => {
    const map: Record<string, { total: number; count: number; setups: number }> = {};
    for (const s of stocks) {
      const sec = s.sector || "Other";
      if (!map[sec]) map[sec] = { total: 0, count: 0, setups: 0 };
      map[sec].total += s.changePercent;
      map[sec].count++;
      if ((s.opportunityScore ?? 0) >= 55) map[sec].setups++;
    }
    return Object.entries(map).map(([sector, v]) => ({
      sector, avgChange: v.count > 0 ? v.total / v.count : 0, count: v.count, setups: v.setups,
    })).sort((a, b) => b.avgChange - a.avgChange);
  }, [stocks]);

  if (loading) return <Skeleton h={40} cols={2} />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
      {sectorPerf.map(s => {
        const isUp = s.avgChange >= 0;
        const intensity = Math.min(Math.abs(s.avgChange) / 3, 1);
        const bg = isUp ? `hsl(142 76% 52% / ${0.05 + intensity * 0.15})` : `hsl(4 90% 63% / ${0.05 + intensity * 0.15})`;
        return (
          <div key={s.sector} style={{ padding: "11px 14px", background: bg, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600 }}>{s.sector}</div>
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>{s.count} stocks · {s.setups} setups</div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))", fontVariantNumeric: "tabular-nums" }}>
              {isUp ? "+" : ""}{s.avgChange.toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function VolLeadersModule({ stocks, loading }: { stocks: Stock[]; loading: boolean }) {
  const leaders = useMemo(() =>
    [...stocks].filter(s => (s.ivRank ?? 0) > 0).sort((a, b) => (b.ivRank ?? 0) - (a.ivRank ?? 0)).slice(0, 8),
    [stocks]);

  if (loading) return <div style={{ padding: 12 }}><Skeleton h={40} /></div>;
  return (
    <div>
      {leaders.map((s, i) => {
        const band = ivBand(s.ivRank ?? 0);
        const isUp = s.changePercent >= 0;
        return (
          <Link key={s.id} href={`/scanner?symbol=${s.symbol}`}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: i < leaders.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined, cursor: "pointer", transition: "background 0.1s" }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}>
              <span style={{ fontSize: 10, fontWeight: 700, width: 16, color: "hsl(var(--muted-foreground))", flexShrink: 0, textAlign: "right" }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{s.symbol}</span>
                  <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 3, background: `${band.color}22`, color: band.color }}>{band.label}</span>
                </div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>{s.setupType ?? "Neutral"} · {s.sector}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: band.color, fontVariantNumeric: "tabular-nums" }}>{Math.round(s.ivRank ?? 0)}%</div>
                <div style={{ fontSize: 10, color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{isUp ? "+" : ""}{s.changePercent.toFixed(2)}%</div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function IvDistributionModule({ stocks, loading }: { stocks: Stock[]; loading: boolean }) {
  const buckets = useMemo(() => {
    const b = [
      { label: "0–20", min: 0, max: 20, count: 0 },
      { label: "20–40", min: 20, max: 40, count: 0 },
      { label: "40–60", min: 40, max: 60, count: 0 },
      { label: "60–80", min: 60, max: 80, count: 0 },
      { label: "80–100", min: 80, max: 101, count: 0 },
    ];
    for (const s of stocks) {
      const iv = s.ivRank ?? 0;
      const bkt = b.find(x => iv >= x.min && iv < x.max);
      if (bkt) bkt.count++;
    }
    return b;
  }, [stocks]);

  if (loading) return <div style={{ height: 160, borderRadius: 6, background: "rgba(255,255,255,0.04)", animation: "pulse 1.4s infinite" }} />;
  return (
    <div style={{ height: 160 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={buckets} barCategoryGap={6}>
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <RechartsTooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0]!.payload;
            return <div style={{ background: "hsl(0 0% 10%)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "6px 10px", fontSize: 11 }}><b>IV {d.label}</b><div style={{ color: "hsl(var(--muted-foreground))" }}>{d.count} stocks</div></div>;
          }} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {buckets.map((_, i) => <Cell key={i} fill={i === 4 ? "hsl(4 90% 63%)" : i === 3 ? "hsl(30 95% 60%)" : i === 2 ? "hsl(var(--primary))" : "rgba(255,255,255,0.18)"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MoverListModule({ stocks, loading, type }: { stocks: Stock[]; loading: boolean; type: "gainer" | "loser" }) {
  if (loading) return <div style={{ padding: 12 }}><Skeleton h={36} /></div>;
  const isUp = type === "gainer";
  return (
    <div>
      {stocks.map((s, i) => (
        <Link key={s.id} href={`/scanner?symbol=${s.symbol}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: i < stocks.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined, cursor: "pointer", transition: "background 0.1s" }}
            onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"}
            onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", width: 14, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{s.symbol}</div>
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatCurrency(s.price)}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))", display: "flex", alignItems: "center", gap: 2, fontVariantNumeric: "tabular-nums" }}>
                {isUp ? <ArrowUpRight style={{ width: 11, height: 11 }} /> : <ArrowDownRight style={{ width: 11, height: 11 }} />}
                {isUp ? "+" : ""}{s.changePercent.toFixed(2)}%
              </div>
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{formatNumber(s.volume)}</div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function WatchlistModule({ watchlist, loading }: { watchlist: any[]; loading: boolean }) {
  const isMobile = useIsMobile();
  const removeFromWatchlist = useRemoveFromWatchlist();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  if (loading) return <div style={{ padding: 14 }}><Skeleton h={52} cols={4} /></div>;
  if (watchlist.length === 0) return (
    <div style={{ padding: "32px 24px", textAlign: "center" }}>
      <Star style={{ width: 28, height: 28, opacity: 0.15, margin: "0 auto 10px" }} />
      <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>No stocks in watchlist yet. Add them from the Scanner.</p>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {watchlist.map((item, index) => {
        const isUp = item.changePercent >= 0;
        const iv = item.ivRank as number | undefined;
        return (
          <div
            key={item.id}
            style={{
              width: "100%",
              padding: "13px 15px",
              borderBottom: index < watchlist.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
              cursor: "pointer",
              transition: "background 0.1s",
            }}
            onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"}
            onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 7 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <Link href={`/scanner?symbol=${item.symbol}`}><span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.02em" }}>{item.symbol}</span></Link>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{formatCurrency(item.price)}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
                  {isUp ? <ArrowUpRight style={{ width: 11, height: 11 }} /> : <ArrowDownRight style={{ width: 11, height: 11 }} />}
                  {formatPercent(item.changePercent)}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
              <Pill label={`TS: ${item.technicalStrength}`} color={item.technicalStrength >= 7 ? "hsl(var(--success))" : item.technicalStrength <= 3 ? "hsl(var(--destructive))" : "hsl(var(--primary))"} />
              {iv != null && iv > 0 && <Pill label={`IV ${Math.round(iv)}%`} color={iv >= 60 ? "hsl(30 95% 60%)" : "hsl(var(--muted-foreground))"} />}
              <button onClick={() => removeFromWatchlist.mutate({ id: item.id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() }); toast({ title: `${item.symbol} removed` }); } })}
                style={{ marginLeft: "auto", fontSize: 10, color: "hsl(var(--muted-foreground))", padding: "2px 6px", borderRadius: 4, border: "none", background: "transparent", cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--destructive))"}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--muted-foreground))"}>
                Remove
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TechnicalAlertsModule({ stocks, loading }: { stocks: Stock[]; loading: boolean }) {
  const isMobile = useIsMobile();
  const overbought = useMemo(() => stocks.filter(s => s.technicalStrength >= 8).sort((a, b) => b.technicalStrength - a.technicalStrength).slice(0, 5), [stocks]);
  const oversold   = useMemo(() => stocks.filter(s => s.technicalStrength <= 2).sort((a, b) => a.technicalStrength - b.technicalStrength).slice(0, 5), [stocks]);
  if (loading) return <Skeleton h={40} />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
      {[
        { label: "Overbought (TS ≥ 8)", stocks: overbought, color: "hsl(var(--destructive))", icon: <ChevronUp style={{ width: 11, height: 11 }} /> },
        { label: "Oversold (TS ≤ 2)", stocks: oversold, color: "hsl(var(--success))", icon: <ChevronDown style={{ width: 11, height: 11 }} /> },
      ].map(group => (
        <div key={group.label}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: group.color, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>{group.icon}{group.label}</div>
          {group.stocks.length === 0
            ? <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", padding: "12px 0" }}>None found</div>
            : group.stocks.map(s => (
              <Link key={s.id} href={`/scanner?symbol=${s.symbol}`}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer" }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{s.symbol}</span>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <Pill label={`TS ${s.technicalStrength}`} color={group.color} />
                    <span style={{ fontSize: 11, color: s.changePercent >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))", fontVariantNumeric: "tabular-nums" }}>
                      {s.changePercent >= 0 ? "+" : ""}{s.changePercent.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </Link>
            ))
          }
        </div>
      ))}
    </div>
  );
}

function CoveredCallsModule({ stocks, loading }: { stocks: Stock[]; loading: boolean }) {
  const ideas = useMemo(() =>
    stocks.filter(s => s.recommendedOutlook === "bullish" && (s.ivRank ?? 0) >= 40)
      .sort((a, b) => (b.ivRank ?? 0) - (a.ivRank ?? 0)).slice(0, 8),
    [stocks]);
  if (loading) return <div style={{ padding: 12 }}><Skeleton h={40} /></div>;
  return (
    <div>
      {ideas.map((s, i) => {
        const band = ivBand(s.ivRank ?? 0);
        return (
          <Link key={s.id} href={`/scanner?symbol=${s.symbol}`}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: i < ideas.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined, cursor: "pointer", transition: "background 0.1s" }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{s.symbol}</span>
                  <Pill label={`IV ${Math.round(s.ivRank ?? 0)}%`} color={band.color} />
                </div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>{s.name?.substring(0, 28)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{formatCurrency(s.price)}</div>
                <div style={{ fontSize: 10, color: s.changePercent >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))", fontVariantNumeric: "tabular-nums" }}>
                  {s.changePercent >= 0 ? "+" : ""}{s.changePercent.toFixed(2)}%
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function MostActiveModule({ stocks, loading }: { stocks: Stock[]; loading: boolean }) {
  const active = useMemo(() => [...stocks].sort((a, b) => b.volume - a.volume).slice(0, 8), [stocks]);
  if (loading) return <div style={{ padding: 12 }}><Skeleton h={40} /></div>;
  return (
    <div>
      {active.map((s, i) => (
        <Link key={s.id} href={`/scanner?symbol=${s.symbol}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: i < active.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined, cursor: "pointer", transition: "background 0.1s" }}
            onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"}
            onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", width: 14, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{s.symbol}</span>
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>{formatCurrency(s.price)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "hsl(var(--foreground))" }}>{formatNumber(s.volume)}</div>
              <div style={{ fontSize: 10, color: s.changePercent >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))", fontVariantNumeric: "tabular-nums" }}>
                {s.changePercent >= 0 ? "+" : ""}{s.changePercent.toFixed(2)}%
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function Week52Module({ stocks, loading }: { stocks: Stock[]; loading: boolean }) {
  const isMobile = useIsMobile();
  const nearHigh = useMemo(() => stocks.filter(s => s.fiftyTwoWeekHigh && s.price >= s.fiftyTwoWeekHigh * 0.95).sort((a, b) => b.price / b.fiftyTwoWeekHigh! - a.price / a.fiftyTwoWeekHigh!).slice(0, 5), [stocks]);
  const nearLow  = useMemo(() => stocks.filter(s => s.fiftyTwoWeekLow && s.price <= s.fiftyTwoWeekLow * 1.08).sort((a, b) => a.price / a.fiftyTwoWeekLow! - b.price / b.fiftyTwoWeekLow!).slice(0, 5), [stocks]);
  if (loading) return <Skeleton h={40} />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
      {[
        { label: "Near 52W High", list: nearHigh, color: "hsl(var(--success))", icon: <ChevronUp style={{ width: 11, height: 11 }} /> },
        { label: "Near 52W Low",  list: nearLow,  color: "hsl(var(--destructive))", icon: <ChevronDown style={{ width: 11, height: 11 }} /> },
      ].map(group => (
        <div key={group.label}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: group.color, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>{group.icon}{group.label}</div>
          {group.list.length === 0
            ? <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", padding: "12px 0" }}>None found</div>
            : group.list.map(s => {
              const pct = group.label.includes("High") ? (s.price / s.fiftyTwoWeekHigh! * 100).toFixed(1) : (s.price / s.fiftyTwoWeekLow! * 100).toFixed(1);
              return (
                <Link key={s.id} href={`/scanner?symbol=${s.symbol}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer" }}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{s.symbol}</span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
                      <Pill label={formatCurrency(s.price)} color={group.color} />
                    </div>
                  </div>
                </Link>
              );
            })
          }
        </div>
      ))}
    </div>
  );
}

function EarningsModule({ stocks, loading }: { stocks: Stock[]; loading: boolean }) {
  const upcoming = useMemo(() =>
    stocks.filter(s => {
      const d = daysUntil(s.earningsDate);
      return d !== null && d >= 0 && d <= 30;
    }).sort((a, b) => {
      const da = daysUntil(a.earningsDate) ?? 999;
      const db = daysUntil(b.earningsDate) ?? 999;
      return da - db;
    }).slice(0, 10),
    [stocks]);
  if (loading) return <div style={{ padding: 12 }}><Skeleton h={40} /></div>;
  if (upcoming.length === 0) return <div style={{ padding: "24px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 12 }}>No upcoming earnings in the next 30 days</div>;
  return (
    <div>
      {upcoming.map((s, i) => {
        const dte = daysUntil(s.earningsDate);
        const band = ivBand(s.ivRank ?? 0);
        return (
          <Link key={s.id} href={`/scanner?symbol=${s.symbol}`}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: i < upcoming.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined, cursor: "pointer", transition: "background 0.1s" }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{s.symbol}</span>
                  <Pill label={`IV ${Math.round(s.ivRank ?? 0)}%`} color={band.color} />
                </div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>{s.earningsDate}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: dte === 0 ? "hsl(var(--destructive))" : dte! <= 7 ? "hsl(30 95% 60%)" : "hsl(var(--foreground))" }}>
                  {dte === 0 ? "Today" : dte === 1 ? "Tomorrow" : `${dte}d`}
                </div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(s.price)}</div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function PortfolioModule({ stocks }: { stocks: Stock[] }) {
  const portfolio: string[] = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("portfolio") || "[]"); } catch { return []; }
  }, []);
  const positions = useMemo(() => stocks.filter(s => portfolio.includes(s.symbol)), [stocks, portfolio]);
  if (positions.length === 0) return (
    <div style={{ padding: "32px 24px", textAlign: "center" }}>
      <Briefcase style={{ width: 28, height: 28, opacity: 0.15, margin: "0 auto 10px" }} />
      <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>No portfolio positions saved yet. Use the + Portfolio button in the Scanner.</p>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {positions.map((s, index) => {
        const isUp = s.changePercent >= 0;
        return (
          <Link key={s.id} href={`/scanner?symbol=${s.symbol}`}>
            <div
              style={{
                width: "100%",
                padding: "13px 15px",
                borderBottom: index < positions.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                cursor: "pointer",
                transition: "background 0.1s",
              }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 6 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{s.symbol}</span>
                  <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.sector}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{formatCurrency(s.price)}</div>
                  <span style={{ fontSize: 11, color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))", fontVariantNumeric: "tabular-nums" }}>
                    {isUp ? "+" : ""}{s.changePercent.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ── Customize Panel ────────────────────────────────────────────────────────
function CustomizePanel({ order, enabled, onToggle, onMove, onReset, onClose }: {
  order: string[]; enabled: string[];
  onToggle: (id: string) => void;
  onMove: (id: string, dir: "up" | "down") => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const categories = [
    { key: "market",   label: "Market Data" },
    { key: "analysis", label: "Analysis" },
    { key: "personal", label: "Personal" },
  ] as const;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 99, backdropFilter: "blur(4px)" }} />
      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 360, zIndex: 100,
        background: "hsl(0 0% 7%)", borderLeft: "1px solid rgba(255,255,255,0.1)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "18px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>Customize Dashboard</div>
            <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>Toggle and reorder modules</div>
          </div>
          <button onClick={onClose} style={{ padding: 6, borderRadius: 6, border: "none", background: "rgba(255,255,255,0.06)", cursor: "pointer", color: "hsl(var(--muted-foreground))", display: "flex" }}>
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>

        <ScrollArea className="flex-1">
          <div style={{ padding: "16px 20px 32px", display: "flex", flexDirection: "column", gap: 24 }}>

            {/* Active order */}
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", color: "hsl(var(--muted-foreground))", marginBottom: 10 }}>ACTIVE ORDER</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {order.filter(id => enabled.includes(id)).map((id, i, arr) => {
                  const mod = MODULE_REGISTRY.find(m => m.id === id)!;
                  if (!mod) return null;
                  return (
                    <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
                      <div style={{ color: "hsl(var(--muted-foreground))" }}>{mod.icon}</div>
                      <span style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>{mod.title}</span>
                      <div style={{ display: "flex", gap: 2 }}>
                        <button onClick={() => onMove(id, "up")} disabled={i === 0} style={{ padding: "3px 5px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.3 : 1, color: "hsl(var(--muted-foreground))", display: "flex" }}>
                          <ArrowUp style={{ width: 10, height: 10 }} />
                        </button>
                        <button onClick={() => onMove(id, "down")} disabled={i === arr.length - 1} style={{ padding: "3px 5px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", cursor: i === arr.length - 1 ? "default" : "pointer", opacity: i === arr.length - 1 ? 0.3 : 1, color: "hsl(var(--muted-foreground))", display: "flex" }}>
                          <ArrowDown style={{ width: 10, height: 10 }} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Module library by category */}
            {categories.map(cat => {
              const mods = MODULE_REGISTRY.filter(m => m.category === cat.key);
              return (
                <div key={cat.key}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", color: "hsl(var(--muted-foreground))", marginBottom: 10 }}>{cat.label.toUpperCase()}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {mods.map(mod => {
                      const on = enabled.includes(mod.id);
                      return (
                        <button key={mod.id} onClick={() => onToggle(mod.id)} style={{
                          display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 8,
                          border: on ? "1px solid hsl(var(--primary)/0.3)" : "1px solid rgba(255,255,255,0.07)",
                          background: on ? "hsl(var(--primary)/0.06)" : "rgba(255,255,255,0.02)",
                          cursor: "pointer", textAlign: "left", width: "100%", transition: "all 0.12s",
                        }}>
                          {on
                            ? <CheckCircle2 style={{ width: 14, height: 14, color: "hsl(var(--primary))", flexShrink: 0, marginTop: 1 }} />
                            : <Circle style={{ width: 14, height: 14, color: "rgba(255,255,255,0.2)", flexShrink: 0, marginTop: 1 }} />
                          }
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: on ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>{mod.title}</div>
                            <div style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))", marginTop: 2, lineHeight: 1.4 }}>{mod.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Reset */}
            <button onClick={onReset} style={{ padding: "9px 0", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "hsl(var(--muted-foreground))", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
              Reset to defaults
            </button>
          </div>
        </ScrollArea>
      </div>
    </>
  );
}

// ── Main DashboardPage ─────────────────────────────────────────────────────
export default function DashboardPage() {
  const [config, setConfig] = useState<DashboardConfig>(loadConfig);
  const [customizing, setCustomizing] = useState(false);
  const isMobile = useIsMobile();

  const { data: topMovers, isLoading: loadingMovers } = useGetTopMovers();
  const { data: watchlist = [], isLoading: loadingWatchlist } = useGetWatchlist({
    query: {
      queryKey: getGetWatchlistQueryKey(),
      staleTime: 5_000,
      refetchInterval: 5_000,
      refetchIntervalInBackground: true,
    },
  });
  const { data: stocks = [], isLoading: loadingStocks } = useListStocks();

  const persist = useCallback((next: DashboardConfig) => {
    setConfig(next);
    saveConfig(next);
  }, []);

  const toggleModule = (id: string) => {
    const enabled = config.enabled.includes(id)
      ? config.enabled.filter(x => x !== id)
      : [...config.enabled, id];
    // Ensure order includes this id
    const order = config.order.includes(id) ? config.order : [...config.order, id];
    persist({ order, enabled });
  };

  const moveModule = (id: string, dir: "up" | "down") => {
    const activeOrder = config.order.filter(x => config.enabled.includes(x));
    const i = activeOrder.indexOf(id);
    if (i < 0) return;
    const ni = dir === "up" ? i - 1 : i + 1;
    if (ni < 0 || ni >= activeOrder.length) return;
    const next = [...activeOrder];
    [next[i], next[ni]] = [next[ni]!, next[i]!];
    // Rebuild full order: inactive modules stay at end
    const inactive = config.order.filter(x => !config.enabled.includes(x));
    persist({ order: [...next, ...inactive], enabled: config.enabled });
  };

  const resetConfig = () => persist({ order: DEFAULT_ORDER, enabled: DEFAULT_ENABLED });

  // Ordered enabled modules
  const activeModules = config.order
    .filter(id => config.enabled.includes(id))
    .map(id => MODULE_REGISTRY.find(m => m.id === id))
    .filter(Boolean) as ModuleDef[];

  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  function renderModuleContent(mod: ModuleDef) {
    switch (mod.id) {
      case "account_summary": return <AccountSummaryModule />;
      case "stats":           return <StatsModule stocks={stocks} loadingStocks={loadingStocks} />;
      case "opportunities":   return <OpportunitiesModule stocks={stocks} loading={loadingStocks} />;
      case "sector_perf":     return <Section title="Sector Performance" sub="Avg daily change" icon={<BarChart2 style={{ width: 14, height: 14, color: "hsl(var(--primary))" }} />} noPad><SectorPerfModule stocks={stocks} loading={loadingStocks} /></Section>;
      case "vol_leaders":     return <Section title="Volatility Leaders" sub="Highest IV rank" icon={<Flame style={{ width: 14, height: 14, color: "hsl(30 95% 60%)" }} />} noPad><VolLeadersModule stocks={stocks} loading={loadingStocks} /></Section>;
      case "iv_distribution": return <Section title="IV Distribution" sub="Universe volatility spread" icon={<Activity style={{ width: 14, height: 14, color: "hsl(var(--primary))" }} />}><IvDistributionModule stocks={stocks} loading={loadingStocks} /></Section>;
      case "gainers":         return <Section title="Top Gainers" icon={<TrendingUp style={{ width: 14, height: 14, color: "hsl(var(--success))" }} />} noPad><MoverListModule stocks={topMovers?.gainers ?? []} loading={loadingMovers} type="gainer" /></Section>;
      case "losers":          return <Section title="Top Losers" icon={<TrendingDown style={{ width: 14, height: 14, color: "hsl(var(--destructive))" }} />} noPad><MoverListModule stocks={topMovers?.losers ?? []} loading={loadingMovers} type="loser" /></Section>;
      case "watchlist":       return <Section title="Watchlist" sub="Your tracked assets" icon={<Star style={{ width: 14, height: 14, color: "hsl(var(--primary))" }} />} noPad><WatchlistModule watchlist={watchlist} loading={loadingWatchlist} /></Section>;
      case "technical_alerts":return <Section title="Technical Alerts" sub="RSI signals" icon={<Bell style={{ width: 14, height: 14, color: "hsl(var(--primary))" }} />}><TechnicalAlertsModule stocks={stocks} loading={loadingStocks} /></Section>;
      case "covered_calls":   return <Section title="Covered Call Ideas" sub="Bullish + High IV" icon={<Briefcase style={{ width: 14, height: 14, color: "hsl(var(--success))" }} />} noPad><CoveredCallsModule stocks={stocks} loading={loadingStocks} /></Section>;
      case "most_active":     return <Section title="Most Active" sub="By volume" icon={<Volume2 style={{ width: 14, height: 14, color: "hsl(var(--primary))" }} />} noPad><MostActiveModule stocks={stocks} loading={loadingStocks} /></Section>;
      case "week52":          return <Section title="52-Week Extremes" icon={<ChevronUp style={{ width: 14, height: 14, color: "hsl(var(--primary))" }} />}><Week52Module stocks={stocks} loading={loadingStocks} /></Section>;
      case "earnings":        return <Section title="Earnings Watch" sub="Next 30 days" icon={<Calendar style={{ width: 14, height: 14, color: "hsl(var(--primary))" }} />} noPad><EarningsModule stocks={stocks} loading={loadingStocks} /></Section>;
      case "portfolio":       return <Section title="Portfolio" sub="Saved positions" icon={<Briefcase style={{ width: 14, height: 14, color: "hsl(var(--primary))" }} />} noPad><PortfolioModule stocks={stocks} /></Section>;
      default: return null;
    }
  }

  // Group modules into grid rows (12-col system)
  const gridRows: ModuleDef[][] = [];
  let currentRow: ModuleDef[] = [];
  let currentCols = 0;

  for (const mod of activeModules) {
    if (mod.id === "stats" || mod.id === "account_summary") {
      // These modules render outside the grid (no Section wrapper)
      if (currentRow.length > 0) { gridRows.push([...currentRow]); currentRow = []; currentCols = 0; }
      gridRows.push([mod]);
      continue;
    }
    if (currentCols + mod.cols > 12) {
      gridRows.push([...currentRow]);
      currentRow = [mod];
      currentCols = mod.cols;
    } else {
      currentRow.push(mod);
      currentCols += mod.cols;
    }
  }
  if (currentRow.length > 0) gridRows.push(currentRow);

  return (
    <ScrollArea className="h-full w-full" style={{ background: "hsl(0 0% 4%)" }}>
      <div style={{ padding: isMobile ? "16px 12px 80px" : "28px 24px 60px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: isMobile ? "center" : "flex-start", justifyContent: "space-between", marginBottom: isMobile ? 14 : 22, flexWrap: "wrap", gap: 8 }}>
          <div>
            <h1 style={{ fontSize: isMobile ? 18 : 24, fontWeight: 700, letterSpacing: "-0.03em", display: "flex", alignItems: "center", gap: 9, marginBottom: 3 }}>
              <LayoutDashboard style={{ width: isMobile ? 16 : 20, height: isMobile ? 16 : 20, color: "hsl(var(--primary))" }} />
              Market Dashboard
            </h1>
            {!isMobile && <p style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>{dateStr}</p>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <MarketStatusPill />
            <button onClick={() => setCustomizing(true)} style={{
              display: "flex", alignItems: "center", gap: 7, padding: "9px 20px", borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)",
              color: "hsl(var(--foreground))", fontSize: 14, fontWeight: 500, cursor: "pointer",
              transition: "all 0.12s", letterSpacing: "-0.01em",
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.10)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
            >
              <LayoutGrid style={{ width: 15, height: 15 }} />
              Customize
            </button>
          </div>
        </div>

        {/* Module grid */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {gridRows.map((row, ri) => {
            if (row.length === 1 && (row[0]!.id === "stats" || row[0]!.id === "account_summary")) {
              return <div key={ri}>{renderModuleContent(row[0]!)}</div>;
            }
            if (row.length === 1 && row[0]!.cols === 12) {
              return <div key={ri}>{renderModuleContent(row[0]!)}</div>;
            }
            const colDefs = isMobile ? "1fr" : row.map(m => `${m.cols}fr`).join(" ");
            return (
              <div key={ri} style={{ display: "grid", gridTemplateColumns: colDefs, gap: isMobile ? 10 : 14 }}>
                {row.map(mod => <div key={mod.id} style={{ minWidth: 0 }}>{renderModuleContent(mod)}</div>)}
              </div>
            );
          })}
        </div>

        {activeModules.length === 0 && (
          <div style={{ textAlign: "center", padding: "80px 20px" }}>
            <LayoutGrid style={{ width: 36, height: 36, opacity: 0.15, margin: "0 auto 14px" }} />
            <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))", marginBottom: 16 }}>No modules enabled. Add some to get started.</p>
            <button onClick={() => setCustomizing(true)} style={{ padding: "9px 22px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "hsl(var(--foreground))", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
              Open customize panel
            </button>
          </div>
        )}
      </div>

      {/* Customize panel */}
      {customizing && (
        <CustomizePanel
          order={config.order}
          enabled={config.enabled}
          onToggle={toggleModule}
          onMove={moveModule}
          onReset={resetConfig}
          onClose={() => setCustomizing(false)}
        />
      )}
    </ScrollArea>
  );
}
