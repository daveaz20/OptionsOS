import { useMemo, useState, useCallback, useRef } from "react";
import { useListStocks } from "@workspace/api-client-react";
import type { Stock } from "@workspace/api-client-react";
import {
  ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronRight,
  Download, SlidersHorizontal, X, Target, Zap, TrendingUp,
  TrendingDown, Flame, DollarSign, BarChart2, Calendar,
  Activity, Star, Search, RotateCcw, Filter, ArrowRight,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────
interface FilterConfig {
  // Volatility & Options
  ivRankMin: string; ivRankMax: string;
  opportunityScoreMin: string; opportunityScoreMax: string;
  // Technical
  technicalStrengthMin: string; technicalStrengthMax: string;
  changePercentMin: string; changePercentMax: string;
  pctFrom52WHigh: string;   // max distance from 52W high (e.g. -20 = within 20% below)
  pctFrom52WLow: string;    // min distance from 52W low  (e.g. 5 = at least 5% above)
  supportDistPct: string;   // min % above support
  resistDistPct: string;    // max % below resistance
  // Fundamental
  priceMin: string; priceMax: string;
  marketCapMin: string; marketCapMax: string; // billions
  peMin: string; peMax: string;
  divYieldMin: string; divYieldMax: string;
  // Categorical
  sectors: string[];
  outlooks: string[];
  setupTypes: string[];
  liquidities: string[];
  // Earnings
  daysToEarningsMax: string;
  // Momentum composite
  momentumScoreMin: string;
}

const BLANK: FilterConfig = {
  ivRankMin: "", ivRankMax: "", opportunityScoreMin: "", opportunityScoreMax: "",
  technicalStrengthMin: "", technicalStrengthMax: "", changePercentMin: "", changePercentMax: "",
  pctFrom52WHigh: "", pctFrom52WLow: "", supportDistPct: "", resistDistPct: "",
  priceMin: "", priceMax: "", marketCapMin: "", marketCapMax: "",
  peMin: "", peMax: "", divYieldMin: "", divYieldMax: "",
  sectors: [], outlooks: [], setupTypes: [], liquidities: [],
  daysToEarningsMax: "", momentumScoreMin: "",
};

type SortKey = keyof ReturnType<typeof deriveRow>;
interface SortConfig { key: SortKey; dir: "asc" | "desc" }

// ── Presets ───────────────────────────────────────────────────────────────
interface Preset {
  id: string; label: string; description: string;
  icon: React.ReactNode; color: string;
  filters: Partial<FilterConfig>;
}

const PRESETS: Preset[] = [
  { id: "iv_crush",       label: "IV Crush",           icon: <Target style={{ width: 12, height: 12 }} />,     color: "hsl(4 90% 63%)",         description: "High IV stocks with earnings in ≤14 days — sell premium before crush",           filters: { ivRankMin: "60", daysToEarningsMax: "14" } },
  { id: "premium_sell",   label: "Premium Sellers",    icon: <Flame style={{ width: 12, height: 12 }} />,       color: "hsl(30 95% 60%)",        description: "Elevated IV, neutral outlook — Iron Condor and Strangle candidates",            filters: { ivRankMin: "65", outlooks: ["neutral"] } },
  { id: "momentum",       label: "Momentum",           icon: <TrendingUp style={{ width: 12, height: 12 }} />,  color: "hsl(142 76% 52%)",       description: "Technically strong stocks within 10% of 52-week high",                         filters: { technicalStrengthMin: "7", pctFrom52WHigh: "-10" } },
  { id: "oversold",       label: "Oversold Bounce",    icon: <TrendingDown style={{ width: 12, height: 12 }} />, color: "hsl(217 91% 60%)",      description: "Oversold technicals with bullish opportunity score — mean reversion",           filters: { technicalStrengthMax: "3", opportunityScoreMin: "50", outlooks: ["bullish"] } },
  { id: "cheap_opts",     label: "Cheap Options",      icon: <DollarSign style={{ width: 12, height: 12 }} />,  color: "hsl(142 76% 52%)",       description: "Low IV rank — buy debit spreads before vol expansion",                         filters: { ivRankMax: "25" } },
  { id: "high_conv",      label: "High Conviction",    icon: <Zap style={{ width: 12, height: 12 }} />,          color: "hsl(217 91% 60%)",       description: "Top scoring setups across the full universe",                                   filters: { opportunityScoreMin: "75" } },
  { id: "earnings_plays", label: "Earnings Plays",     icon: <Calendar style={{ width: 12, height: 12 }} />,     color: "hsl(280 60% 65%)",       description: "Reporting in ≤7 days — elevated IV, straddle candidates",                      filters: { ivRankMin: "50", daysToEarningsMax: "7" } },
  { id: "income",         label: "Income & Div",       icon: <Star style={{ width: 12, height: 12 }} />,          color: "hsl(50 95% 55%)",        description: "Dividend payers with elevated IV — wheel strategy candidates",                  filters: { divYieldMin: "1", ivRankMin: "30", outlooks: ["bullish", "neutral"] } },
  { id: "large_bull",     label: "Large Cap Bull",     icon: <BarChart2 style={{ width: 12, height: 12 }} />,    color: "hsl(142 76% 52%)",       description: "Mega-cap bullish setups — institutional-grade momentum plays",                 filters: { marketCapMin: "50", outlooks: ["bullish"] } },
  { id: "sr_squeeze",     label: "S/R Squeeze",        icon: <Activity style={{ width: 12, height: 12 }} />,     color: "hsl(30 95% 60%)",        description: "Near support with room to resistance — favorable risk/reward",                  filters: { supportDistPct: "0", resistDistPct: "20" } },
];

// ── Columns ───────────────────────────────────────────────────────────────
interface ColDef { key: SortKey; label: string; defaultVisible: boolean; group: string; align?: "right" | "left" }

const COLUMNS: ColDef[] = [
  { key: "symbol",          label: "Symbol",      defaultVisible: true,  group: "identity", align: "left" },
  { key: "name",            label: "Name",        defaultVisible: true,  group: "identity", align: "left" },
  { key: "price",           label: "Price",       defaultVisible: true,  group: "price",    align: "right" },
  { key: "changePercent",   label: "Day %",       defaultVisible: true,  group: "price",    align: "right" },
  { key: "volume",          label: "Volume",      defaultVisible: true,  group: "price",    align: "right" },
  { key: "marketCapB",      label: "Mkt Cap",     defaultVisible: true,  group: "fundamental", align: "right" },
  { key: "sector",          label: "Sector",      defaultVisible: false, group: "fundamental", align: "left" },
  { key: "pe",              label: "P/E",         defaultVisible: true,  group: "fundamental", align: "right" },
  { key: "dividendYield",   label: "Div %",       defaultVisible: false, group: "fundamental", align: "right" },
  { key: "ivRank",          label: "IV Rank",     defaultVisible: true,  group: "volatility",  align: "right" },
  { key: "opportunityScore","label": "Score",     defaultVisible: true,  group: "options",  align: "right" },
  { key: "technicalStrength","label": "Tech",     defaultVisible: true,  group: "technical",align: "right" },
  { key: "momentumScore",   label: "Momentum",    defaultVisible: true,  group: "technical",align: "right" },
  { key: "pctFrom52High",   label: "vs 52H",      defaultVisible: true,  group: "technical",align: "right" },
  { key: "pctFrom52Low",    label: "vs 52L",      defaultVisible: false, group: "technical",align: "right" },
  { key: "supportDist",     label: "vs Sup",      defaultVisible: false, group: "technical",align: "right" },
  { key: "resistDist",      label: "vs Res",      defaultVisible: false, group: "technical",align: "right" },
  { key: "recommendedOutlook","label":"Outlook",  defaultVisible: true,  group: "strategy", align: "left" },
  { key: "setupType",       label: "Setup",       defaultVisible: true,  group: "strategy", align: "left" },
  { key: "daysToEarnings",  label: "DTE Earn",    defaultVisible: true,  group: "events",   align: "right" },
  { key: "liquidity",       label: "Liquidity",   defaultVisible: false, group: "micro",    align: "left" },
];

// ── Derived row type ──────────────────────────────────────────────────────
function deriveRow(s: Stock & { pe?: number; dividendYield?: number; eps?: number }) {
  const pctFrom52High = s.fiftyTwoWeekHigh ? ((s.price / s.fiftyTwoWeekHigh) - 1) * 100 : null;
  const pctFrom52Low  = s.fiftyTwoWeekLow  ? ((s.price / s.fiftyTwoWeekLow)  - 1) * 100 : null;
  const supportDist   = s.supportPrice     ? ((s.price / s.supportPrice)  - 1) * 100 : null;
  const resistDist    = s.resistancePrice  ? ((s.resistancePrice / s.price) - 1) * 100 : null;
  const dte = (() => {
    if (!s.earningsDate) return null;
    const d = new Date(s.earningsDate);
    if (isNaN(d.getTime())) return null;
    return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  })();
  // Composite momentum: weighted blend of technical strength (0–10) and 1-day change
  const momentumScore = Math.round(
    Math.min(10, Math.max(0,
      s.technicalStrength * 0.7 + Math.min(3, Math.max(-3, s.changePercent / 2)) + 1.5
    ))
  );
  return {
    ...s,
    pe:            (s as any).pe            as number | undefined,
    dividendYield: (s as any).dividendYield as number | undefined,
    marketCapB:    s.marketCap / 1e9,
    pctFrom52High,
    pctFrom52Low,
    supportDist,
    resistDist,
    daysToEarnings: dte,
    momentumScore,
  };
}
type DerivedRow = ReturnType<typeof deriveRow>;

// ── Filter logic ──────────────────────────────────────────────────────────
function n(v: string) { const p = parseFloat(v); return isNaN(p) ? null : p; }

function passesFilters(r: DerivedRow, f: FilterConfig): boolean {
  const ch = (v: number | null | undefined, min: string, max: string) => {
    if (v == null) return true;
    if (n(min) !== null && v < n(min)!) return false;
    if (n(max) !== null && v > n(max)!) return false;
    return true;
  };
  if (!ch(r.ivRank, f.ivRankMin, f.ivRankMax)) return false;
  if (!ch(r.opportunityScore, f.opportunityScoreMin, f.opportunityScoreMax)) return false;
  if (!ch(r.technicalStrength, f.technicalStrengthMin, f.technicalStrengthMax)) return false;
  if (!ch(r.changePercent, f.changePercentMin, f.changePercentMax)) return false;
  if (!ch(r.price, f.priceMin, f.priceMax)) return false;
  if (!ch(r.marketCapB, f.marketCapMin, f.marketCapMax)) return false;
  if (!ch(r.pe, f.peMin, f.peMax)) return false;
  if (!ch(r.dividendYield, f.divYieldMin, f.divYieldMax)) return false;
  if (!ch(r.momentumScore, f.momentumScoreMin, "")) return false;
  // 52W high distance (negative = below high; filter = "within X% of high")
  if (n(f.pctFrom52WHigh) !== null && r.pctFrom52High !== null && r.pctFrom52High < n(f.pctFrom52WHigh)!) return false;
  if (n(f.pctFrom52WLow) !== null && r.pctFrom52Low !== null && r.pctFrom52Low < n(f.pctFrom52WLow)!) return false;
  if (n(f.supportDistPct) !== null && r.supportDist !== null && r.supportDist < n(f.supportDistPct)!) return false;
  if (n(f.resistDistPct) !== null && r.resistDist !== null && r.resistDist > n(f.resistDistPct)!) return false;
  if (n(f.daysToEarningsMax) !== null) {
    if (r.daysToEarnings === null) return false;
    if (r.daysToEarnings < 0 || r.daysToEarnings > n(f.daysToEarningsMax)!) return false;
  }
  if (f.sectors.length && !f.sectors.includes(r.sector)) return false;
  if (f.outlooks.length && !f.outlooks.includes(r.recommendedOutlook ?? "")) return false;
  if (f.setupTypes.length && !f.setupTypes.includes(r.setupType ?? "")) return false;
  if (f.liquidities.length && !f.liquidities.includes(r.liquidity ?? "")) return false;
  return true;
}

function countActive(f: FilterConfig): number {
  let c = 0;
  const fields: (keyof FilterConfig)[] = [
    "ivRankMin","ivRankMax","opportunityScoreMin","opportunityScoreMax",
    "technicalStrengthMin","technicalStrengthMax","changePercentMin","changePercentMax",
    "pctFrom52WHigh","pctFrom52WLow","supportDistPct","resistDistPct",
    "priceMin","priceMax","marketCapMin","marketCapMax","peMin","peMax",
    "divYieldMin","divYieldMax","daysToEarningsMax","momentumScoreMin",
  ];
  for (const k of fields) if ((f[k] as string) !== "") c++;
  if (f.sectors.length) c++;
  if (f.outlooks.length) c++;
  if (f.setupTypes.length) c++;
  if (f.liquidities.length) c++;
  return c;
}

// ── Format helpers ────────────────────────────────────────────────────────
const fmt = {
  currency: (v: number | null) => v == null ? "—" : v >= 1000 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`,
  pct:      (v: number | null) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`,
  pctSign:  (v: number | null) => v == null ? "—" : `${v >= 0 ? "+" : ""}${Math.abs(v).toFixed(1)}%`,
  cap:      (v: number | null) => { if (v == null) return "—"; if (v >= 1000) return `$${(v/1000).toFixed(1)}T`; if (v >= 1) return `$${v.toFixed(1)}B`; return `$${(v*1000).toFixed(0)}M`; },
  vol:      (v: number | null) => { if (v == null) return "—"; if (v >= 1e9) return `${(v/1e9).toFixed(1)}B`; if (v >= 1e6) return `${(v/1e6).toFixed(1)}M`; if (v >= 1e3) return `${(v/1e3).toFixed(0)}K`; return `${v}`; },
  pe:       (v: number | null | undefined) => v == null || v <= 0 ? "—" : v.toFixed(1),
  div:      (v: number | null | undefined) => v == null || v <= 0 ? "—" : `${v.toFixed(2)}%`,
  ivRank:   (v: number | null | undefined) => v == null ? "—" : `${Math.round(v)}%`,
  ts:       (v: number) => `${v}/10`,
  dte:      (v: number | null) => v == null ? "—" : v === 0 ? "Today" : v === 1 ? "1d" : `${v}d`,
};

// ── Colors ────────────────────────────────────────────────────────────────
const OL_COLOR: Record<string, string> = { bullish: "hsl(142 76% 52%)", bearish: "hsl(4 90% 63%)", neutral: "hsl(217 91% 60%)" };
const OL_BG:    Record<string, string> = { bullish: "hsl(142 76% 52%/0.12)", bearish: "hsl(4 90% 63%/0.12)", neutral: "hsl(217 91% 60%/0.12)" };

function ivColor(r: number | null | undefined) {
  if (r == null) return "hsl(var(--muted-foreground))";
  if (r >= 80) return "hsl(4 90% 63%)";
  if (r >= 60) return "hsl(30 95% 60%)";
  if (r >= 40) return "hsl(217 91% 60%)";
  return "hsl(var(--muted-foreground))";
}
function scoreColor(s: number | null | undefined) {
  if (s == null) return "hsl(var(--muted-foreground))";
  if (s >= 70) return "hsl(142 76% 52%)";
  if (s >= 50) return "hsl(217 91% 60%)";
  return "hsl(var(--muted-foreground))";
}
function tsColor(v: number) {
  if (v >= 8) return "hsl(142 76% 52%)";
  if (v >= 6) return "hsl(217 91% 60%)";
  if (v <= 2) return "hsl(4 90% 63%)";
  if (v <= 4) return "hsl(30 95% 60%)";
  return "hsl(var(--muted-foreground))";
}
function momColor(v: number) { return v >= 8 ? "hsl(142 76% 52%)" : v >= 6 ? "hsl(217 91% 60%)" : v <= 2 ? "hsl(4 90% 63%)" : "hsl(var(--muted-foreground))"; }

// ── Sub-components ────────────────────────────────────────────────────────
function FilterGroup({ title, icon, children, defaultOpen = true }: {
  title: string; icon?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px", background: "transparent", border: "none", cursor: "pointer",
        color: "hsl(var(--foreground))",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", color: "hsl(var(--muted-foreground))" }}>
          {icon}{title}
        </div>
        {open ? <ChevronDown style={{ width: 11, height: 11, color: "hsl(var(--muted-foreground))" }} /> : <ChevronRight style={{ width: 11, height: 11, color: "hsl(var(--muted-foreground))" }} />}
      </button>
      {open && <div style={{ padding: "0 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>}
    </div>
  );
}

function RangeRow({ label, minK, maxK, unit, f, setF, placeholder }: {
  label: string; minK: keyof FilterConfig; maxK: keyof FilterConfig;
  unit?: string; f: FilterConfig; setF: (v: FilterConfig) => void; placeholder?: [string, string];
}) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))", marginBottom: 5 }}>{label}{unit && <span style={{ color: "rgba(255,255,255,0.25)", marginLeft: 4 }}>{unit}</span>}</div>
      <div style={{ display: "flex", gap: 5 }}>
        {(["min","max"] as const).map((side, i) => {
          const k = side === "min" ? minK : maxK;
          return (
            <input key={side}
              type="number"
              value={f[k] as string}
              onChange={e => setF({ ...f, [k]: e.target.value })}
              placeholder={placeholder?.[i] ?? (side === "min" ? "Min" : "Max")}
              style={{
                flex: 1, padding: "5px 8px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.04)", color: "hsl(var(--foreground))", fontSize: 11,
                outline: "none",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function SingleRow({ label, fieldK, unit, f, setF, placeholder }: {
  label: string; fieldK: keyof FilterConfig; unit?: string;
  f: FilterConfig; setF: (v: FilterConfig) => void; placeholder?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))", marginBottom: 5 }}>{label}{unit && <span style={{ color: "rgba(255,255,255,0.25)", marginLeft: 4 }}>{unit}</span>}</div>
      <input
        type="number" value={f[fieldK] as string}
        onChange={e => setF({ ...f, [fieldK]: e.target.value })}
        placeholder={placeholder ?? "Any"}
        style={{ width: "100%", padding: "5px 8px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "hsl(var(--foreground))", fontSize: 11, outline: "none", boxSizing: "border-box" }}
      />
    </div>
  );
}

function MultiToggle({ label, options, selected, onToggle }: {
  label: string; options: string[]; selected: string[]; onToggle: (v: string) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {options.map(o => {
          const on = selected.includes(o);
          return (
            <button key={o} onClick={() => onToggle(o)} style={{
              padding: "3px 9px", borderRadius: 4, fontSize: 10.5, fontWeight: 500, cursor: "pointer",
              border: on ? "1px solid hsl(var(--primary)/0.5)" : "1px solid rgba(255,255,255,0.1)",
              background: on ? "hsl(var(--primary)/0.12)" : "rgba(255,255,255,0.03)",
              color: on ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
              transition: "all 0.1s",
            }}>{o}</button>
          );
        })}
      </div>
    </div>
  );
}

function SortIcon({ colKey, sort }: { colKey: SortKey; sort: SortConfig }) {
  if (sort.key !== colKey) return <ArrowUpDown style={{ width: 9, height: 9, opacity: 0.3 }} />;
  return sort.dir === "asc"
    ? <ArrowUp style={{ width: 9, height: 9, color: "hsl(var(--primary))" }} />
    : <ArrowDown style={{ width: 9, height: 9, color: "hsl(var(--primary))" }} />;
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div style={{ width: 36, height: 3, borderRadius: 99, background: "rgba(255,255,255,0.08)", overflow: "hidden", display: "inline-block", verticalAlign: "middle", marginLeft: 4 }}>
      <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: "100%", borderRadius: 99, background: color }} />
    </div>
  );
}

// ── Main Screener Page ────────────────────────────────────────────────────
export default function ScreenerPage() {
  const { data: rawStocks = [], isLoading } = useListStocks();
  const [filters, setFilters] = useState<FilterConfig>(BLANK);
  const [sort, setSort] = useState<SortConfig>({ key: "opportunityScore", dir: "desc" });
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key as string))
  );
  const [showColPicker, setShowColPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const stocks = useMemo(() => rawStocks.map(s => deriveRow(s as any)), [rawStocks]);

  // Available distinct values for multi-toggles
  const allSectors    = useMemo(() => [...new Set(stocks.map(s => s.sector).filter(Boolean))].sort(), [stocks]);
  const allSetupTypes = useMemo(() => [...new Set(stocks.map(s => s.setupType).filter(Boolean))].sort(), [stocks]);

  // Apply filters + search + sort
  const filtered = useMemo(() => {
    let rows = stocks.filter(r => passesFilters(r, filters));
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r => r.symbol.toLowerCase().includes(q) || r.name?.toLowerCase().includes(q));
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = a[sort.key] as any;
      const bv = b[sort.key] as any;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
    return rows;
  }, [stocks, filters, search, sort]);

  // Aggregate stats for factor bar
  const aggStats = useMemo(() => {
    if (!filtered.length) return null;
    const avg = (vals: (number | null | undefined)[]) => {
      const v = vals.filter(x => x != null) as number[];
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    return {
      count:       filtered.length,
      bullish:     filtered.filter(r => r.recommendedOutlook === "bullish").length,
      neutral:     filtered.filter(r => r.recommendedOutlook === "neutral").length,
      bearish:     filtered.filter(r => r.recommendedOutlook === "bearish").length,
      avgIvRank:   avg(filtered.map(r => r.ivRank)),
      avgScore:    avg(filtered.map(r => r.opportunityScore)),
      avgTs:       avg(filtered.map(r => r.technicalStrength)),
      avgMom:      avg(filtered.map(r => r.momentumScore)),
      highIv:      filtered.filter(r => (r.ivRank ?? 0) >= 60).length,
      withEarnings:filtered.filter(r => r.daysToEarnings != null && r.daysToEarnings >= 0 && r.daysToEarnings <= 14).length,
    };
  }, [filtered]);

  const toggleSort = (key: SortKey) => {
    setSort(s => s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" });
  };

  const applyPreset = useCallback((p: Preset) => {
    if (activePreset === p.id) { setFilters(BLANK); setActivePreset(null); return; }
    setFilters({ ...BLANK, ...p.filters });
    setActivePreset(p.id);
  }, [activePreset]);

  const toggleCatFilter = (cat: keyof Pick<FilterConfig, "sectors" | "outlooks" | "setupTypes" | "liquidities">, val: string) => {
    const cur = filters[cat];
    const next = cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val];
    setFilters({ ...filters, [cat]: next });
    setActivePreset(null);
  };

  const resetAll = () => { setFilters(BLANK); setActivePreset(null); setSearch(""); };

  const activeCount = countActive(filters) + (search ? 1 : 0);

  // Export CSV
  const exportCsv = () => {
    const visCols = COLUMNS.filter(c => visibleCols.has(c.key as string));
    const header = visCols.map(c => c.label).join(",");
    const rows = filtered.map(r => visCols.map(c => {
      const v = r[c.key];
      if (v == null) return "";
      if (typeof v === "string") return `"${v.replace(/"/g, '""')}"`;
      return v;
    }).join(",")).join("\n");
    const blob = new Blob([header + "\n" + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "screener.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const visCols = COLUMNS.filter(c => visibleCols.has(c.key as string));

  return (
    <div style={{ display: "flex", height: "100%", background: "hsl(0 0% 4%)", overflow: "hidden" }}>

      {/* ── Filter Sidebar ── */}
      <div style={{ width: 230, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.01)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, letterSpacing: "-0.01em" }}>
            <SlidersHorizontal style={{ width: 12, height: 12, color: "hsl(var(--primary))" }} />
            Filters
            {activeCount > 0 && <span style={{ background: "hsl(var(--primary))", color: "#000", borderRadius: 99, fontSize: 9, fontWeight: 700, padding: "1px 5px" }}>{activeCount}</span>}
          </div>
          {activeCount > 0 && (
            <button onClick={resetAll} style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
              <RotateCcw style={{ width: 9, height: 9 }} /> Clear
            </button>
          )}
        </div>

        <ScrollArea className="flex-1">
          {/* Volatility & Options */}
          <FilterGroup title="VOLATILITY & OPTIONS" icon={<Flame style={{ width: 10, height: 10 }} />}>
            <RangeRow label="IV Rank" minK="ivRankMin" maxK="ivRankMax" unit="%" f={filters} setF={f => { setFilters(f); setActivePreset(null); }} placeholder={["0","100"]} />
            <RangeRow label="Opportunity Score" minK="opportunityScoreMin" maxK="opportunityScoreMax" f={filters} setF={f => { setFilters(f); setActivePreset(null); }} placeholder={["0","200"]} />
          </FilterGroup>

          {/* Technical */}
          <FilterGroup title="TECHNICAL" icon={<Activity style={{ width: 10, height: 10 }} />}>
            <RangeRow label="Technical Strength" minK="technicalStrengthMin" maxK="technicalStrengthMax" unit="/10" f={filters} setF={f => { setFilters(f); setActivePreset(null); }} placeholder={["1","10"]} />
            <SingleRow label="Momentum Score ≥" fieldK="momentumScoreMin" unit="/10" f={filters} setF={f => { setFilters(f); setActivePreset(null); }} />
            <RangeRow label="Day Change" minK="changePercentMin" maxK="changePercentMax" unit="%" f={filters} setF={f => { setFilters(f); setActivePreset(null); }} placeholder={["-20","+20"]} />
            <SingleRow label="Within % of 52W High" fieldK="pctFrom52WHigh" f={filters} setF={f => { setFilters(f); setActivePreset(null); }} placeholder="e.g. -10" />
            <SingleRow label="% Above 52W Low ≥" fieldK="pctFrom52WLow" f={filters} setF={f => { setFilters(f); setActivePreset(null); }} placeholder="e.g. 5" />
            <SingleRow label="% Above Support ≥" fieldK="supportDistPct" f={filters} setF={f => { setFilters(f); setActivePreset(null); }} placeholder="e.g. 0" />
            <SingleRow label="% Below Resistance ≤" fieldK="resistDistPct" f={filters} setF={f => { setFilters(f); setActivePreset(null); }} placeholder="e.g. 15" />
          </FilterGroup>

          {/* Fundamental */}
          <FilterGroup title="FUNDAMENTAL" icon={<DollarSign style={{ width: 10, height: 10 }} />}>
            <RangeRow label="Price" minK="priceMin" maxK="priceMax" unit="$" f={filters} setF={f => { setFilters(f); setActivePreset(null); }} />
            <RangeRow label="Market Cap" minK="marketCapMin" maxK="marketCapMax" unit="$B" f={filters} setF={f => { setFilters(f); setActivePreset(null); }} />
            <RangeRow label="P/E Ratio" minK="peMin" maxK="peMax" f={filters} setF={f => { setFilters(f); setActivePreset(null); }} />
            <RangeRow label="Dividend Yield" minK="divYieldMin" maxK="divYieldMax" unit="%" f={filters} setF={f => { setFilters(f); setActivePreset(null); }} />
          </FilterGroup>

          {/* Categorical */}
          <FilterGroup title="STRATEGY" icon={<Target style={{ width: 10, height: 10 }} />}>
            <MultiToggle label="Outlook" options={["bullish","neutral","bearish"]} selected={filters.outlooks}
              onToggle={v => toggleCatFilter("outlooks", v)} />
            <MultiToggle label="Setup Type" options={allSetupTypes} selected={filters.setupTypes}
              onToggle={v => toggleCatFilter("setupTypes", v)} />
          </FilterGroup>

          {/* Events */}
          <FilterGroup title="EVENTS" icon={<Calendar style={{ width: 10, height: 10 }} />} defaultOpen={false}>
            <SingleRow label="Earnings within (days)" fieldK="daysToEarningsMax" f={filters} setF={f => { setFilters(f); setActivePreset(null); }} placeholder="e.g. 14" />
          </FilterGroup>

          {/* Sector */}
          <FilterGroup title="SECTOR" icon={<BarChart2 style={{ width: 10, height: 10 }} />} defaultOpen={false}>
            <MultiToggle label="Sector" options={allSectors} selected={filters.sectors}
              onToggle={v => toggleCatFilter("sectors", v)} />
          </FilterGroup>

          {/* Liquidity */}
          <FilterGroup title="LIQUIDITY" icon={<Activity style={{ width: 10, height: 10 }} />} defaultOpen={false}>
            <MultiToggle label="Liquidity" options={["Liquid","Illiquid"]} selected={filters.liquidities}
              onToggle={v => toggleCatFilter("liquidities", v)} />
          </FilterGroup>
        </ScrollArea>
      </div>

      {/* ── Right: Results ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

        {/* Top bar */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Presets */}
          <div style={{ display: "flex", gap: 6, flexWrap: "nowrap", overflowX: "auto", paddingBottom: 2 }}>
            <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", flexShrink: 0, display: "flex", alignItems: "center", gap: 4, marginRight: 2 }}>
              <Filter style={{ width: 10, height: 10 }} /> Presets:
            </span>
            {PRESETS.map(p => {
              const on = activePreset === p.id;
              return (
                <button key={p.id} onClick={() => applyPreset(p)} title={p.description} style={{
                  padding: "4px 10px", borderRadius: 5, fontSize: 10.5, fontWeight: 500,
                  border: on ? `1px solid ${p.color}50` : "1px solid rgba(255,255,255,0.1)",
                  background: on ? `${p.color}18` : "rgba(255,255,255,0.03)",
                  color: on ? p.color : "hsl(var(--muted-foreground))",
                  cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.1s",
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                  {p.icon}{p.label}
                </button>
              );
            })}
          </div>

          {/* Search + controls + count */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative", flex: 1, maxWidth: 240 }}>
              <Search style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", width: 12, height: 12, color: "hsl(var(--muted-foreground))" }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search symbol or name…"
                style={{ width: "100%", paddingLeft: 28, paddingRight: 8, paddingTop: 6, paddingBottom: 6, borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "hsl(var(--foreground))", fontSize: 11.5, outline: "none", boxSizing: "border-box" }} />
              {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", display: "flex" }}><X style={{ width: 11, height: 11 }} /></button>}
            </div>

            <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontWeight: 700, color: "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums" }}>{filtered.length}</span>
              <span>of {stocks.length} stocks</span>
            </div>

            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {/* Column picker */}
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowColPicker(o => !o)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "hsl(var(--muted-foreground))", fontSize: 11, cursor: "pointer" }}>
                  <SlidersHorizontal style={{ width: 11, height: 11 }} /> Columns
                </button>
                {showColPicker && (
                  <>
                    <div onClick={() => setShowColPicker(false)} style={{ position: "fixed", inset: 0, zIndex: 49 }} />
                    <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50, background: "hsl(0 0% 10%)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: 12, width: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
                      {["identity","price","fundamental","volatility","options","technical","strategy","events","micro"].map(grp => {
                        const cols = COLUMNS.filter(c => c.group === grp);
                        if (!cols.length) return null;
                        return (
                          <div key={grp} style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", color: "hsl(var(--muted-foreground))", marginBottom: 5, textTransform: "uppercase" }}>{grp}</div>
                            {cols.map(col => (
                              <label key={col.key as string} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 0", cursor: "pointer" }}>
                                <input type="checkbox" checked={visibleCols.has(col.key as string)}
                                  onChange={e => setVisibleCols(s => {
                                    const n = new Set(s);
                                    if (e.target.checked) n.add(col.key as string); else n.delete(col.key as string);
                                    return n;
                                  })} />
                                <span style={{ fontSize: 11.5 }}>{col.label}</span>
                              </label>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              <button onClick={exportCsv} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "hsl(var(--muted-foreground))", fontSize: 11, cursor: "pointer" }}>
                <Download style={{ width: 11, height: 11 }} /> Export
              </button>
            </div>
          </div>
        </div>

        {/* Factor analysis bar */}
        {aggStats && (
          <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)", background: "rgba(255,255,255,0.015)", display: "flex", gap: 20, flexShrink: 0, flexWrap: "wrap" }}>
            {[
              { label: "Bullish", value: `${aggStats.bullish}`, color: "hsl(142 76% 52%)" },
              { label: "Neutral", value: `${aggStats.neutral}`, color: "hsl(217 91% 60%)" },
              { label: "Bearish", value: `${aggStats.bearish}`, color: "hsl(4 90% 63%)" },
              { label: "Avg IV Rank", value: aggStats.avgIvRank != null ? `${aggStats.avgIvRank.toFixed(0)}%` : "—", color: ivColor(aggStats.avgIvRank) },
              { label: "Avg Score", value: aggStats.avgScore != null ? aggStats.avgScore.toFixed(0) : "—", color: scoreColor(aggStats.avgScore) },
              { label: "Avg Tech", value: aggStats.avgTs != null ? `${aggStats.avgTs.toFixed(1)}/10` : "—", color: tsColor(Math.round(aggStats.avgTs ?? 5)) },
              { label: "High IV", value: `${aggStats.highIv}`, color: "hsl(30 95% 60%)" },
              { label: "Near Earnings", value: `${aggStats.withEarnings}`, color: "hsl(280 60% 65%)" },
            ].map(stat => (
              <div key={stat.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>{stat.label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: stat.color, fontVariantNumeric: "tabular-nums" }}>{stat.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Table */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          <ScrollArea className="h-full">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, zIndex: 10, background: "hsl(0 0% 6%)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                  {visCols.map(col => (
                    <th key={col.key as string}
                      onClick={() => toggleSort(col.key)}
                      style={{
                        padding: "8px 10px", textAlign: col.align ?? "right", fontSize: 10, fontWeight: 600,
                        letterSpacing: "0.04em", color: sort.key === col.key ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                        cursor: "pointer", whiteSpace: "nowrap", userSelect: "none",
                        borderBottom: sort.key === col.key ? "1px solid hsl(var(--primary)/0.4)" : "1px solid transparent",
                      }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                        {col.label} <SortIcon colKey={col.key} sort={sort} />
                      </span>
                    </th>
                  ))}
                  <th style={{ width: 32 }} />
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={visCols.length + 1} style={{ padding: 32, textAlign: "center", color: "hsl(var(--muted-foreground))" }}>Loading universe…</td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={visCols.length + 1} style={{ padding: 40, textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>No stocks match the current filters.</td></tr>
                )}
                {filtered.map((r, i) => (
                  <tr key={r.symbol}
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.035)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.008)", cursor: "pointer", transition: "background 0.08s" }}
                    onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = "rgba(255,255,255,0.035)"}
                    onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.008)"}>
                    {visCols.map(col => (
                      <td key={col.key as string} style={{ padding: "7px 10px", textAlign: col.align ?? "right", whiteSpace: "nowrap" }}>
                        {renderCell(col.key, r)}
                      </td>
                    ))}
                    <td style={{ padding: "7px 6px 7px 0" }}>
                      <Link href={`/scanner?symbol=${r.symbol}`}>
                        <button style={{ padding: "3px 7px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", cursor: "pointer", color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center" }}>
                          <ArrowRight style={{ width: 10, height: 10 }} />
                        </button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

function renderCell(key: SortKey, r: DerivedRow): React.ReactNode {
  switch (key) {
    case "symbol": return (
      <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: "-0.01em" }}>{r.symbol}</span>
    );
    case "name": return (
      <span style={{ color: "hsl(var(--muted-foreground))", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{r.name}</span>
    );
    case "price": return (
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt.currency(r.price)}</span>
    );
    case "changePercent": {
      const up = r.changePercent >= 0;
      return (
        <span style={{ color: up ? "hsl(142 76% 52%)" : "hsl(4 90% 63%)", fontVariantNumeric: "tabular-nums", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
          {up ? <ArrowUp style={{ width: 9, height: 9 }} /> : <ArrowDown style={{ width: 9, height: 9 }} />}
          {Math.abs(r.changePercent).toFixed(2)}%
        </span>
      );
    }
    case "volume": return <span style={{ color: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}>{fmt.vol(r.volume)}</span>;
    case "marketCapB": return <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt.cap(r.marketCapB)}</span>;
    case "sector": return <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 10.5 }}>{r.sector ?? "—"}</span>;
    case "pe": return <span style={{ fontVariantNumeric: "tabular-nums", color: r.pe && r.pe < 15 ? "hsl(142 76% 52%)" : r.pe && r.pe > 50 ? "hsl(4 90% 63%)" : "hsl(var(--foreground))" }}>{fmt.pe(r.pe)}</span>;
    case "dividendYield": return <span style={{ fontVariantNumeric: "tabular-nums", color: (r.dividendYield ?? 0) > 0 ? "hsl(142 76% 52%)" : "hsl(var(--muted-foreground))" }}>{fmt.div(r.dividendYield)}</span>;
    case "ivRank": {
      const c = ivColor(r.ivRank);
      return (
        <span style={{ color: c, fontWeight: 600, fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
          {fmt.ivRank(r.ivRank)}
          <MiniBar value={r.ivRank ?? 0} max={100} color={c} />
        </span>
      );
    }
    case "opportunityScore": {
      const c = scoreColor(r.opportunityScore);
      return (
        <span style={{ color: c, fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
          {r.opportunityScore ?? "—"}
          <MiniBar value={r.opportunityScore ?? 0} max={200} color={c} />
        </span>
      );
    }
    case "technicalStrength": {
      const c = tsColor(r.technicalStrength);
      return <span style={{ color: c, fontWeight: 600 }}>{fmt.ts(r.technicalStrength)}</span>;
    }
    case "momentumScore": {
      const c = momColor(r.momentumScore);
      return <span style={{ color: c, fontWeight: 600 }}>{r.momentumScore}/10</span>;
    }
    case "pctFrom52High": {
      const v = r.pctFrom52High;
      return <span style={{ fontVariantNumeric: "tabular-nums", color: v != null && v >= -5 ? "hsl(142 76% 52%)" : "hsl(var(--muted-foreground))" }}>{v != null ? `${v.toFixed(1)}%` : "—"}</span>;
    }
    case "pctFrom52Low": {
      const v = r.pctFrom52Low;
      return <span style={{ fontVariantNumeric: "tabular-nums", color: v != null && v <= 10 ? "hsl(4 90% 63%)" : "hsl(var(--muted-foreground))" }}>{v != null ? `+${v.toFixed(1)}%` : "—"}</span>;
    }
    case "supportDist": {
      const v = r.supportDist;
      return <span style={{ fontVariantNumeric: "tabular-nums", color: v != null && v < 3 ? "hsl(30 95% 60%)" : "hsl(var(--muted-foreground))" }}>{v != null ? `+${v.toFixed(1)}%` : "—"}</span>;
    }
    case "resistDist": {
      const v = r.resistDist;
      return <span style={{ fontVariantNumeric: "tabular-nums", color: v != null && v < 5 ? "hsl(4 90% 63%)" : "hsl(var(--muted-foreground))" }}>{v != null ? `${v.toFixed(1)}%` : "—"}</span>;
    }
    case "recommendedOutlook": {
      const ol = r.recommendedOutlook ?? "neutral";
      return <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 3, background: OL_BG[ol], color: OL_COLOR[ol], textTransform: "capitalize" }}>{ol}</span>;
    }
    case "setupType": return <span style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))" }}>{r.setupType ?? "—"}</span>;
    case "daysToEarnings": {
      const v = r.daysToEarnings;
      const urgent = v != null && v >= 0 && v <= 7;
      const soon   = v != null && v >= 0 && v <= 14;
      return <span style={{ fontVariantNumeric: "tabular-nums", color: urgent ? "hsl(4 90% 63%)" : soon ? "hsl(30 95% 60%)" : "hsl(var(--muted-foreground))", fontWeight: urgent ? 700 : 400 }}>{fmt.dte(v != null && v < 0 ? null : v)}</span>;
    }
    case "liquidity": return <span style={{ fontSize: 10.5, color: r.liquidity === "Liquid" ? "hsl(142 76% 52%)" : "hsl(var(--muted-foreground))" }}>{r.liquidity ?? "—"}</span>;
    default: return <span>—</span>;
  }
}
