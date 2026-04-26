import React, { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useSettings } from "@/contexts/SettingsContext";
import type { AppSettings } from "@/lib/settings-defaults";
import { useGetWatchlist, useAddToWatchlist, useRemoveFromWatchlist, getGetWatchlistQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScreenerRow {
  symbol: string; name: string; price: number; change: number; changePercent: number;
  volume: number; avgVolume: number; relVol: number; marketCap: number; sector: string;
  beta: number; pe: number; forwardPE: number; eps: number; dividendYield: number;
  shortRatio: number; priceTarget: number; recommendation: number;
  fiftyTwoWeekHigh: number; fiftyTwoWeekLow: number;
  pctFrom52High: number; pctFrom52Low: number; earningsDate: string;
  technicalStrength: number; rsi14: number; macdHistogram: number; ivRank: number;
  opportunityScore: number; technicalScore: number; ivScore: number; entryScore: number;
  momentumScore: number; riskScore: number;
  weakFactors?: string[]; scoreCapped?: boolean;
  setupType: string; recommendedOutlook: string;
  supportPrice: number; resistancePrice: number; liquidity: string;
  source?: "polygon" | "yahoo" | "polygon-eod";
  priceSource?: "tastytrade-live" | "tastytrade-rest" | "polygon";
}

interface FactoredRow extends ScreenerRow {
  fMomentum: number; fValue: number; fQuality: number; fVolatility: number; fOptions: number;
  alpha: number;
  daysToEarnings: number;
}

// ─── Filter definitions ───────────────────────────────────────────────────────

type FilterType = "range" | "select" | "minonly";

interface FilterDef {
  key: string;
  label: string;
  category: "General" | "Technicals" | "Fundamentals" | "Options" | "Factors";
  type: FilterType;
  unit?: string;
  options?: { value: string; label: string }[];
  min?: number; max?: number; step?: number;
  field: (r: FactoredRow) => number | string;
}

const FILTER_DEFS: FilterDef[] = [
  { key:"sector",        label:"Sector",          category:"General",      type:"select",  field:r=>r.sector,
    options:[{value:"",label:"All Sectors"},{value:"Technology",label:"Technology"},{value:"Healthcare",label:"Healthcare"},{value:"Financial Services",label:"Financials"},{value:"Consumer Cyclical",label:"Consumer Cyclical"},{value:"Consumer Defensive",label:"Consumer Defensive"},{value:"Industrials",label:"Industrials"},{value:"Communication Services",label:"Communication Services"},{value:"Energy",label:"Energy"},{value:"Basic Materials",label:"Basic Materials"},{value:"Real Estate",label:"Real Estate"},{value:"Utilities",label:"Utilities"}] },
  { key:"outlook",       label:"Outlook",         category:"General",      type:"select",  field:r=>r.recommendedOutlook,
    options:[{value:"",label:"Any"},{value:"bullish",label:"Bullish"},{value:"neutral",label:"Neutral"},{value:"bearish",label:"Bearish"}] },
  { key:"marketCap",     label:"Market Cap",      category:"General",      type:"select",  field:r=>r.marketCap,
    options:[{value:"",label:"Any size"},{value:"small",label:"Small (<$2B)"},{value:"mid",label:"Mid ($2–10B)"},{value:"large",label:"Large ($10–200B)"},{value:"mega",label:"Mega (>$200B)"}] },
  { key:"price",         label:"Price",           category:"General",      type:"range",   unit:"$",  field:r=>r.price,           min:0,   max:2000, step:1   },
  { key:"changePercent", label:"Change %",        category:"General",      type:"range",   unit:"%",  field:r=>r.changePercent,   min:-20, max:20,   step:0.1 },
  { key:"relVol",        label:"Rel. Volume",     category:"General",      type:"minonly", unit:"×",  field:r=>r.relVol,          min:0,   max:20,   step:0.1 },
  { key:"volume",        label:"Volume",          category:"General",      type:"minonly",            field:r=>r.volume,          min:0 },
  { key:"beta",          label:"Beta",            category:"General",      type:"range",   field:r=>r.beta,            min:0,  max:5,  step:0.1 },
  { key:"liquidity",     label:"Liquidity",       category:"General",      type:"select",  field:r=>r.liquidity,
    options:[{value:"",label:"All"},{value:"Liquid",label:"Liquid only"}] },
  { key:"rsi14",         label:"RSI (14)",        category:"Technicals",   type:"range",              field:r=>r.rsi14,           min:0,  max:100 },
  { key:"technicalStr",  label:"Tech Strength",   category:"Technicals",   type:"range",              field:r=>r.technicalStrength,min:1, max:10, step:0.1 },
  { key:"pctFrom52High", label:"% From 52W High", category:"Technicals",   type:"range",   unit:"%",  field:r=>r.pctFrom52High,  min:-100,max:50 },
  { key:"pctFrom52Low",  label:"% From 52W Low",  category:"Technicals",   type:"range",   unit:"%",  field:r=>r.pctFrom52Low,   min:0,  max:500 },
  { key:"pe",            label:"P/E Ratio",       category:"Fundamentals", type:"range",              field:r=>r.pe,              min:0,  max:500 },
  { key:"forwardPE",     label:"Forward P/E",     category:"Fundamentals", type:"range",              field:r=>r.forwardPE,       min:0,  max:200 },
  { key:"eps",           label:"EPS",             category:"Fundamentals", type:"range",   unit:"$",  field:r=>r.eps,            min:-50,max:200 },
  { key:"dividendYield", label:"Div Yield %",     category:"Fundamentals", type:"minonly", unit:"%",  field:r=>r.dividendYield,  min:0,  max:20 },
  { key:"shortRatio",    label:"Short Ratio",     category:"Fundamentals", type:"minonly", unit:"d",  field:r=>r.shortRatio,     min:0,  max:30 },
  { key:"ivRank",        label:"IV Rank",         category:"Options",      type:"range",   unit:"%",  field:r=>r.ivRank,         min:0,  max:100 },
  { key:"opportunityScore",label:"Opp. Score",    category:"Options",      type:"minonly",            field:r=>r.opportunityScore,min:0,max:100 },
  { key:"technicalScore",label:"Technical",       category:"Options",      type:"minonly",            field:r=>r.technicalScore, min:0, max:10, step:0.5 },
  { key:"ivScore",       label:"IV Regime",       category:"Options",      type:"minonly",            field:r=>r.ivScore, min:0, max:10, step:0.5 },
  { key:"momentumScore", label:"Momentum",        category:"Options",      type:"minonly",            field:r=>r.momentumScore, min:0, max:10, step:0.5 },
  { key:"entryScore",    label:"Entry Quality",   category:"Options",      type:"minonly",            field:r=>r.entryScore, min:0, max:10, step:0.5 },
  { key:"riskScore",     label:"Risk (Earnings)", category:"Options",      type:"minonly",            field:r=>r.riskScore, min:0, max:10, step:0.5 },
  { key:"marketCapNum",  label:"Mkt Cap ($)",     category:"General",      type:"range",              field:r=>r.marketCap,       min:0 },
  { key:"daysToEarnings",label:"Days to Earnings",category:"General",      type:"range",              field:r=>r.daysToEarnings,  min:0, max:365 },
  { key:"alpha",         label:"Alpha Score",     category:"Factors",      type:"minonly",            field:r=>r.alpha,           min:0,  max:100 },
  { key:"fMomentum",     label:"Momentum",        category:"Factors",      type:"minonly",            field:r=>r.fMomentum,       min:0,  max:100 },
  { key:"fValue",        label:"Value",           category:"Factors",      type:"minonly",            field:r=>r.fValue,          min:0,  max:100 },
  { key:"fQuality",      label:"Quality",         category:"Factors",      type:"minonly",            field:r=>r.fQuality,        min:0,  max:100 },
  { key:"fVolatility",   label:"Volatility Rank", category:"Factors",      type:"minonly",            field:r=>r.fVolatility,     min:0,  max:100 },
];

const CATEGORIES = ["General","Technicals","Fundamentals","Options","Factors"] as const;

interface ActiveFilter {
  key: string;
  min?: string;
  max?: string;
  value?: string;
}

// ─── Column tabs ──────────────────────────────────────────────────────────────

type TabKey = "overview" | "performance" | "technicals" | "fundamentals" | "options" | "factors";

const TABS: { key: TabKey; label: string }[] = [
  { key:"overview",      label:"Overview" },
  { key:"performance",   label:"Performance" },
  { key:"technicals",    label:"Technicals" },
  { key:"fundamentals",  label:"Fundamentals" },
  { key:"options",       label:"Options" },
  { key:"factors",       label:"Factor Alpha" },
];

// ─── Quick screens (presets) ──────────────────────────────────────────────────

const PRESETS = [
  { label:"All",           filters:[] as ActiveFilter[] },
  { label:"Options Seller",filters:[{key:"ivRank",min:"65"},{key:"marketCap",value:"mid"}] as ActiveFilter[] },
  { label:"Momentum",      filters:[{key:"momentumScore",min:"7"},{key:"technicalScore",min:"6"}] as ActiveFilter[] },
  { label:"High Volume",   filters:[{key:"relVol",min:"2"}] as ActiveFilter[] },
  { label:"Value",         filters:[{key:"pe",max:"20"},{key:"dividendYield",min:"1"}] as ActiveFilter[] },
  { label:"Bullish Setup", filters:[{key:"outlook",value:"bullish"},{key:"technicalStr",min:"6"}] as ActiveFilter[] },
  { label:"Short Squeeze", filters:[{key:"shortRatio",min:"5"},{key:"changePercent",min:"1"}] as ActiveFilter[] },
  { label:"Dividend",      filters:[{key:"dividendYield",min:"3"}] as ActiveFilter[] },
  { label:"High IV",       filters:[{key:"ivRank",min:"70"}] as ActiveFilter[] },
  { label:"Low IV",        filters:[{key:"ivRank",max:"20"}] as ActiveFilter[] },
  { label:"Oversold",      filters:[{key:"rsi14",max:"35"}] as ActiveFilter[] },
  { label:"Overbought",    filters:[{key:"rsi14",min:"65"}] as ActiveFilter[] },
  { label:"Earnings Soon", filters:[{key:"daysToEarnings",min:"0",max:"14"}] as ActiveFilter[] },
  { label:"Large Cap",     filters:[{key:"marketCap",value:"large+"}] as ActiveFilter[] },
  { label:"Small Cap",     filters:[{key:"marketCap",value:"small"}] as ActiveFilter[] },
];

function filtersFromScreenerDefaults(settings: AppSettings): ActiveFilter[] {
  const preset = PRESETS.find(p => p.label === settings.screenerDefaultPreset) ?? PRESETS[0];
  const filters = preset.filters.map(filter => ({ ...filter }));

  if (settings.screenerDefaultLiquidity === "liquid") {
    filters.push({ key: "liquidity", value: "Liquid" });
  }

  if (settings.screenerDefaultOutlook && settings.screenerDefaultOutlook !== "all") {
    filters.push({ key: "outlook", value: settings.screenerDefaultOutlook });
  }

  return filters;
}

// ─── Factor engine ────────────────────────────────────────────────────────────

function parseEarningsDays(dateStr: string): number {
  if (!dateStr || dateStr === "TBD") return 999;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 999;
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  return days >= 0 ? days : 999;
}

function pctRank(arr: number[], val: number): number {
  if (arr.length === 0) return 50;
  return Math.min(99, Math.round((arr.filter(v => v < val).length / arr.length) * 100));
}

function computeFactors(rows: ScreenerRow[]): FactoredRow[] {
  if (rows.length === 0) return [];
  const chg  = rows.map(r => r.changePercent);
  const tech  = rows.map(r => r.technicalStrength);
  const rsi   = rows.map(r => r.rsi14);
  const mcap  = rows.map(r => Math.log1p(r.marketCap));
  const peLow = rows.map(r => r.pe > 0 ? -r.pe : -999);
  const fwdLow= rows.map(r => r.forwardPE > 0 ? -r.forwardPE : -999);
  const divY  = rows.map(r => r.dividendYield);
  const p52lo = rows.map(r => r.pctFrom52Low);
  const recInv= rows.map(r => -(r.recommendation));
  const ivR   = rows.map(r => r.ivRank);
  const opp   = rows.map(r => r.opportunityScore);
  const rv    = rows.map(r => Math.min(r.relVol, 10));
  const betaS = rows.map(r => -r.beta);
  return rows.map((r, i) => {
    const fMomentum   = Math.round(pctRank(chg,chg[i])*0.35 + pctRank(tech,tech[i])*0.40 + pctRank(rsi,rsi[i])*0.25);
    const fValue      = Math.round(pctRank(peLow,peLow[i])*0.35 + pctRank(fwdLow,fwdLow[i])*0.25 + pctRank(divY,divY[i])*0.20 + pctRank(p52lo,p52lo[i])*0.20);
    const fQuality    = Math.round(pctRank(mcap,mcap[i])*0.35 + pctRank(recInv,recInv[i])*0.35 + pctRank(betaS,betaS[i])*0.30);
    const fVolatility = pctRank(ivR, ivR[i]);
    const fOptions    = Math.round(pctRank(opp,opp[i])*0.60 + pctRank(rv,Math.min(r.relVol,10))*0.40);
    const alpha       = Math.round((fMomentum + fValue + fQuality + fVolatility + fOptions) / 5);
    return { ...r, fMomentum, fValue, fQuality, fVolatility, fOptions, alpha, daysToEarnings: parseEarningsDays(r.earningsDate) };
  });
}

// ─── Filter application ───────────────────────────────────────────────────────

function applyFilters(rows: FactoredRow[], active: ActiveFilter[]): FactoredRow[] {
  if (active.length === 0) return rows;
  return rows.filter(r => {
    for (const f of active) {
      const def = FILTER_DEFS.find(d => d.key === f.key);
      if (!def) continue;
      const val = def.field(r);
      if (def.type === "select") {
        if (f.value === "" || f.value === undefined) continue;
        if (def.key === "marketCap") {
          const mc = r.marketCap;
          if (f.value === "small"  && !(mc >= 300e6  && mc < 2e9))   return false;
          if (f.value === "mid"    && !(mc >= 2e9    && mc < 10e9))   return false;
          if (f.value === "large"  && !(mc >= 10e9   && mc < 200e9))  return false;
          if (f.value === "mega"   && !(mc >= 200e9))                  return false;
          if (f.value === "large+" && !(mc >= 10e9))                   return false;
        } else {
          if (val !== f.value) return false;
        }
      } else {
        const n = typeof val === "number" ? val : parseFloat(val as string);
        if (f.min !== undefined && f.min !== "" && n < parseFloat(f.min)) return false;
        if (f.max !== undefined && f.max !== "" && n > parseFloat(f.max)) return false;
      }
    }
    return true;
  });
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtBig = (n: number) => {
  if (n >= 1e12) return `$${(n/1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n/1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
};
const fmtVol = (n: number) => {
  if (n >= 1e9) return `${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`;
  return String(n);
};

// ─── Data hook ────────────────────────────────────────────────────────────────

function useScreenerData() {
  const { settings } = useSettings();
  return useQuery<ScreenerRow[]>({
    queryKey: ["screener-v3"],
    queryFn: async () => {
      const res = await fetch("/api/screener");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 3*60*1000, gcTime: 10*60*1000, retry: 2,
    refetchInterval: settings.autoRefresh ? settings.autoRefreshInterval * 1000 : false,
  });
}

function useSourceInfo() {
  return useQuery<{ source: "polygon" | "yahoo" | "polygon-eod"; count: number; cachedAt: number }>({
    queryKey: ["screener-source"],
    queryFn: async () => {
      const res = await fetch("/api/screener/source");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 30*1000, retry: 1,
  });
}

// ─── Filter chip & picker ─────────────────────────────────────────────────────

function filterSummary(f: ActiveFilter): string {
  const def = FILTER_DEFS.find(d => d.key === f.key);
  if (!def) return f.key;
  if (def.type === "select") {
    const opt = def.options?.find(o => o.value === f.value);
    return `${def.label}: ${opt?.label ?? f.value}`;
  }
  if (def.type === "minonly") {
    const u = def.unit ?? "";
    return `${def.label} ≥ ${f.min}${u}`;
  }
  const u = def.unit ?? "";
  if (f.min && f.max) return `${def.label}: ${f.min}–${f.max}${u}`;
  if (f.min)          return `${def.label} ≥ ${f.min}${u}`;
  if (f.max)          return `${def.label} ≤ ${f.max}${u}`;
  return def.label;
}

function FilterPicker({ onAdd, existing }: { onAdd:(f:ActiveFilter)=>void; existing:string[]; }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<FilterDef|null>(null);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [val, setVal] = useState("");

  const visible = FILTER_DEFS.filter(d =>
    !existing.includes(d.key) &&
    (!search || d.label.toLowerCase().includes(search.toLowerCase()) || d.category.toLowerCase().includes(search.toLowerCase()))
  );
  const byCategory = CATEGORIES.map(cat => ({
    cat,
    items: visible.filter(d => d.category === cat),
  })).filter(g => g.items.length > 0);

  const handleAdd = () => {
    if (!selected) return;
    if (selected.type === "select") {
      if (!val) return;
      onAdd({ key: selected.key, value: val });
    } else if (selected.type === "minonly") {
      if (!min) return;
      onAdd({ key: selected.key, min });
    } else {
      if (!min && !max) return;
      onAdd({ key: selected.key, min, max });
    }
    setSelected(null); setMin(""); setMax(""); setVal(""); setSearch("");
  };

  return (
    <div style={{ display:"flex", height:340 }}>
      {/* Left: list */}
      <div style={{ width:220, borderRight:"1px solid rgba(255,255,255,0.07)", display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"8px 10px", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
          <input autoFocus value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search filters…"
            style={{ width:"100%", background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:6, padding:"5px 8px", color:"#fff", fontSize:12, boxSizing:"border-box" }}
          />
        </div>
        <div style={{ flex:1, overflow:"auto" }}>
          {byCategory.map(({ cat, items }) => (
            <div key={cat}>
              <div style={{ fontSize:9, fontWeight:700, color:"rgba(255,255,255,0.3)", padding:"8px 10px 4px", textTransform:"uppercase", letterSpacing:"0.08em" }}>
                {cat} <span style={{ opacity:0.6 }}>({items.length})</span>
              </div>
              {items.map(d => (
                <div key={d.key} onClick={() => { setSelected(d); setMin(""); setMax(""); setVal(""); }}
                  style={{
                    padding:"6px 12px", fontSize:12, cursor:"pointer",
                    background: selected?.key===d.key ? "rgba(10,132,255,0.18)" : "transparent",
                    color: selected?.key===d.key ? "#0a84ff" : "rgba(255,255,255,0.75)",
                  }}
                  onMouseEnter={e=>{ if(selected?.key!==d.key) e.currentTarget.style.background="rgba(255,255,255,0.04)"; }}
                  onMouseLeave={e=>{ if(selected?.key!==d.key) e.currentTarget.style.background="transparent"; }}
                >{d.label}</div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Right: value picker */}
      <div style={{ flex:1, padding:"16px", display:"flex", flexDirection:"column", gap:12 }}>
        {!selected ? (
          <div style={{ color:"rgba(255,255,255,0.25)", fontSize:12, marginTop:20, textAlign:"center" }}>Select a filter to configure it</div>
        ) : (
          <>
            <div style={{ fontSize:14, fontWeight:700 }}>{selected.label}</div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", marginTop:-8 }}>{selected.category}</div>

            {selected.type === "select" && (
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {selected.options?.filter(o=>o.value!=="").map(o => (
                  <label key={o.value} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontSize:12 }}>
                    <input type="radio" name="filter-select" value={o.value} checked={val===o.value} onChange={()=>setVal(o.value)} />
                    {o.label}
                  </label>
                ))}
              </div>
            )}

            {selected.type === "minonly" && (
              <div>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", marginBottom:5 }}>Minimum value {selected.unit ? `(${selected.unit})` : ""}</div>
                <input type="number" value={min} onChange={e=>setMin(e.target.value)}
                  placeholder={`e.g. ${selected.min ?? 0}`}
                  style={{ width:"100%", background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:6, padding:"7px 10px", color:"#fff", fontSize:13, boxSizing:"border-box" }}
                />
              </div>
            )}

            {selected.type === "range" && (
              <div style={{ display:"flex", gap:10 }}>
                {[
                  { label:`Min ${selected.unit??""}`, val:min, set:setMin },
                  { label:`Max ${selected.unit??""}`, val:max, set:setMax },
                ].map(({label,val:v,set}) => (
                  <div key={label} style={{ flex:1 }}>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", marginBottom:5 }}>{label}</div>
                    <input type="number" value={v} onChange={e=>set(e.target.value)}
                      placeholder="Any"
                      style={{ width:"100%", background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:6, padding:"7px 10px", color:"#fff", fontSize:13, boxSizing:"border-box" }}
                    />
                  </div>
                ))}
              </div>
            )}

            <button onClick={handleAdd}
              disabled={selected.type==="select"?!val : selected.type==="minonly"?!min : (!min&&!max)}
              style={{
                marginTop:"auto", padding:"8px 16px", borderRadius:8, border:"none",
                background:"#0a84ff", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer",
                opacity: (selected.type==="select"?!val : selected.type==="minonly"?!min : (!min&&!max)) ? 0.4 : 1,
              }}>
              Add filter
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Screener ────────────────────────────────────────────────────────────

export default function Screener() {
  const [, setLocation] = useLocation();
  const { settings } = useSettings();
  const { data: raw = [], isLoading, isFetching } = useScreenerData();
  const { data: sourceInfo } = useSourceInfo();
  const { data: watchlist = [] } = useGetWatchlist();
  const addToWatchlist    = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [activeFilters,   setActiveFilters]   = useState<ActiveFilter[]>(() => filtersFromScreenerDefaults(settings));
  const [activePreset,    setActivePreset]    = useState(settings.screenerDefaultPreset || "All");
  const [sortKey,         setSortKey]         = useState(settings.screenerDefaultSortColumn || "marketCap");
  const [sortDir,         setSortDir]         = useState<"asc"|"desc">(settings.screenerDefaultSortDirection || "desc");
  const [tab,             setTab]             = useState<TabKey>(() => (settings.screenerDefaultTab as TabKey) || "overview");
  const [showPicker,      setShowPicker]      = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    setSortKey(settings.screenerDefaultSortColumn || "marketCap");
    setSortDir(settings.screenerDefaultSortDirection || "desc");
    setActivePreset(settings.screenerDefaultPreset || "All");
    setActiveFilters(filtersFromScreenerDefaults(settings));
  }, [
    settings.screenerDefaultSortColumn,
    settings.screenerDefaultSortDirection,
    settings.screenerDefaultPreset,
    settings.screenerDefaultLiquidity,
    settings.screenerDefaultOutlook,
  ]);

  const factored = useMemo(() => computeFactors(raw), [raw]);
  const filtered = useMemo(() => {
    const minScore = settings.minOpportunityScoreToShow ?? 0;
    return applyFilters(factored, activeFilters).filter(row => row.opportunityScore >= minScore);
  }, [factored, activeFilters, settings.minOpportunityScoreToShow]);
  const sorted   = useMemo(() => {
    return [...filtered].sort((a,b) => {
      const va = (a as unknown as Record<string, unknown>)[sortKey] ?? 0;
      const vb = (b as unknown as Record<string, unknown>)[sortKey] ?? 0;
      if (typeof va === "string" || typeof vb === "string") {
        const delta = String(va).localeCompare(String(vb));
        return sortDir === "desc" ? -delta : delta;
      }
      const delta = Number(va) - Number(vb);
      return sortDir === "desc" ? -delta : delta;
    });
  }, [filtered, sortKey, sortDir]);

  const watchlistSymbolMap = useMemo(() => {
    const m = new Map<string, number>();
    watchlist.forEach(w => m.set(w.symbol, w.id));
    return m;
  }, [watchlist]);

  const handleWatchlistToggle = (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const watchlistId = watchlistSymbolMap.get(symbol);
    if (watchlistId !== undefined) {
      removeFromWatchlist.mutate({ id: watchlistId }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
          toast({ title: "Removed from watchlist", description: symbol });
        },
      });
    } else {
      addToWatchlist.mutate({ data: { symbol } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
          toast({ title: "Added to watchlist", description: symbol });
        },
      });
    }
  };

  const addFilter   = (f: ActiveFilter) => { setActiveFilters(prev => [...prev.filter(x=>x.key!==f.key), f]); setShowPicker(false); };
  const removeFilter = (key: string)   => setActiveFilters(prev => prev.filter(x=>x.key!==key));

  const applyPreset = (p: typeof PRESETS[0]) => {
    setActiveFilters(p.filters);
    setActivePreset(p.label);
  };

  const onSort = (k: string) => {
    if (sortKey === k) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  const existingKeys = activeFilters.map(f => f.key);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#0a0a0a", color:"#fff", fontFamily:"Inter,system-ui,sans-serif", overflow:"hidden" }}>

      {/* ── Header ── */}
      <div style={{ padding:"10px 16px 0", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:4 }}>
          <div style={{ fontSize:18, fontWeight:700, letterSpacing:"-0.03em" }}>
            {activePreset === "All" ? "All stocks" : activePreset}
          </div>
          {activeFilters.length > 0 && (
            <button onClick={() => { setActiveFilters([]); setActivePreset("All"); }}
              style={{ fontSize:11, color:"rgba(255,69,58,0.8)", background:"none", border:"none", cursor:"pointer", padding:0 }}>
              Clear all
            </button>
          )}
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
            {settings.showDataSourceTags && sourceInfo && (
              <div style={{
                display:"flex", alignItems:"center", gap:5,
                padding:"2px 8px", borderRadius:4,
                background: "rgba(10,132,255,0.12)",
                border: "1px solid rgba(10,132,255,0.3)",
              }}>
                <div style={{
                  width:6, height:6, borderRadius:"50%",
                  background: "#0a84ff",
                  boxShadow: "0 0 6px rgba(10,132,255,0.8)",
                }} />
                <span style={{ fontSize:10, fontWeight:600, letterSpacing:"0.04em",
                  color: "#0a84ff",
                  textTransform:"uppercase" }}>
                  Universe
                </span>
                <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)" }}>
                  {sourceInfo.count.toLocaleString()} stocks
                </span>
              </div>
            )}
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.35)", fontVariantNumeric:"tabular-nums" }}>
              {isLoading ? "Loading…" : `${filtered.length.toLocaleString()} results`}
              {isFetching && !isLoading ? " · Refreshing" : ""}
            </span>
          </div>
        </div>

        {/* ── Preset row ── */}
        <div style={{ display:"flex", gap:5, marginBottom:8, flexWrap:"wrap", alignItems:"center" }}>
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => applyPreset(p)} style={{
              padding:"3px 10px", borderRadius:5, border:"none", fontSize:11, fontWeight:600, cursor:"pointer",
              background: activePreset===p.label && JSON.stringify(activeFilters)===JSON.stringify(p.filters)
                ? "rgba(10,132,255,0.22)" : "rgba(255,255,255,0.06)",
              color: activePreset===p.label && JSON.stringify(activeFilters)===JSON.stringify(p.filters)
                ? "#0a84ff" : "rgba(255,255,255,0.55)",
            }}>{p.label}</button>
          ))}
        </div>

        {/* ── Filter chip bar ── */}
        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", paddingBottom:8, borderBottom:"1px solid rgba(255,255,255,0.07)", position:"relative" }}>
          {activeFilters.map(f => (
            <div key={f.key} style={{
              display:"flex", alignItems:"center", gap:4, padding:"4px 8px 4px 10px",
              background:"rgba(10,132,255,0.12)", border:"1px solid rgba(10,132,255,0.28)",
              borderRadius:6, fontSize:11, color:"#0a84ff", fontWeight:500, whiteSpace:"nowrap",
            }}>
              {filterSummary(f)}
              <button onClick={()=>removeFilter(f.key)} style={{ background:"none", border:"none", color:"rgba(10,132,255,0.7)", cursor:"pointer", padding:"0 0 0 2px", lineHeight:1, fontSize:12 }}>✕</button>
            </div>
          ))}
          {/* Add filter button */}
          <div ref={pickerRef} style={{ position:"relative" }}>
            <button onClick={()=>setShowPicker(s=>!s)} style={{
              display:"flex", alignItems:"center", gap:4,
              padding:"4px 10px", borderRadius:6, border:"1px solid rgba(255,255,255,0.12)",
              background: showPicker ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)",
              color:"rgba(255,255,255,0.55)", fontSize:11, fontWeight:600, cursor:"pointer",
            }}>
              <span style={{ fontSize:14, lineHeight:1 }}>+</span> Add filter
            </button>

            {showPicker && (
              <div style={{
                position:"absolute", top:"calc(100% + 6px)", left:0, zIndex:200,
                background:"#1c1c1e", border:"1px solid rgba(255,255,255,0.1)",
                borderRadius:12, boxShadow:"0 20px 60px rgba(0,0,0,0.7)", minWidth:"min(440px, calc(100vw - 24px))",
                overflow:"hidden",
              }}>
                <FilterPicker onAdd={addFilter} existing={existingKeys} />
              </div>
            )}
          </div>
        </div>

        {/* ── Column tabs ── */}
        <div style={{ display:"flex", gap:0, borderBottom:"1px solid rgba(255,255,255,0.07)", marginTop:2 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={()=>setTab(t.key)} style={{
              padding:"7px 14px", background:"none", border:"none", borderBottom: tab===t.key ? "2px solid #0a84ff" : "2px solid transparent",
              color: tab===t.key ? "#0a84ff" : "rgba(255,255,255,0.4)", fontSize:12, fontWeight:600, cursor:"pointer",
              marginBottom:-1, transition:"color 0.15s",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* ── Table ── */}
      {isLoading ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:12 }}>
          <div style={{ width:32, height:32, borderRadius:"50%", border:"2px solid rgba(10,132,255,0.2)", borderTopColor:"#0a84ff", animation:"spin 0.9s linear infinite" }} />
          <div style={{ color:"rgba(255,255,255,0.35)", fontSize:13 }}>Loading market data…</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : (
        <div style={{ flex:1, overflow:"auto" }}>
          <StockTable rows={sorted} tab={tab} sortKey={sortKey} sortDir={sortDir} onSort={onSort} navigate={setLocation} watchlistSymbolMap={watchlistSymbolMap} onWatchlistToggle={handleWatchlistToggle} />
          {sorted.length > settings.screenerRowsPerPage && (
            <div style={{ padding:"10px", color:"rgba(255,255,255,0.25)", fontSize:11, textAlign:"center" }}>
              Showing {settings.screenerRowsPerPage} of {sorted.length.toLocaleString()} — add filters to narrow results
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Stock Table ──────────────────────────────────────────────────────────────

function StockTable({ rows, tab, sortKey, sortDir, onSort, navigate, watchlistSymbolMap, onWatchlistToggle }: {
  rows: FactoredRow[]; tab: TabKey; sortKey:string; sortDir:"asc"|"desc";
  onSort:(k:string)=>void; navigate:(p:string)=>void;
  watchlistSymbolMap: Map<string, number>;
  onWatchlistToggle: (symbol: string, e: React.MouseEvent) => void;
}) {
  const { settings } = useSettings();
  interface Col { key:string; label:string; width?:number; right?:boolean; render:(r:FactoredRow)=>React.ReactNode }
  const rowPadding = settings.uiDensity === "compact" ? "4px 10px" : "8px 10px";
  const headerPadding = settings.uiDensity === "compact" ? "6px 10px" : "8px 10px";
  const columnVisibility = settings.screenerColumnVisibility;
  const isVisible = (key: string) => columnVisibility[key as keyof typeof columnVisibility] ?? true;
  const scoreTitle = (r: FactoredRow) => settings.showScoreBreakdownTooltip
    ? [
        `Opportunity ${r.opportunityScore}/100`,
        `Technical  ${r.technicalScore}/10`,
        `IV Regime  ${r.ivScore}/10`,
        `Momentum   ${r.momentumScore}/10`,
        `Entry      ${r.entryScore}/10`,
        `Risk       ${r.riskScore}/10`,
        r.scoreCapped ? `⚠ Score capped` : null,
        r.weakFactors?.length ? `Weak: ${r.weakFactors.join(", ")}` : null,
      ].filter(Boolean).join("\n")
    : undefined;

  const baseCol: Col = {
    key:"symbol", label:"Symbol", width:160,
    render:(r)=>(
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <div style={{
          width:28, height:28, borderRadius:6, background:"rgba(10,132,255,0.12)",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:9, fontWeight:800, color:"#0a84ff", flexShrink:0,
        }}>{r.symbol.slice(0,2)}</div>
          <div>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontWeight:700, fontSize:12 }}>{r.symbol}</span>
            {settings.showDataSourceTags && r.source && (
              <span style={{
                padding:"1px 4px", borderRadius:3, fontSize:8, fontWeight:800, letterSpacing:"0.04em",
                color: r.source === "yahoo" ? "hsl(38 92% 50%)" : "hsl(var(--primary))",
                background: r.source === "yahoo" ? "hsl(38 92% 50% / 0.10)" : "hsl(var(--primary) / 0.10)",
              }}>{r.source === "polygon-eod" ? "EOD" : r.source.toUpperCase()}</span>
            )}
          </div>
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", maxWidth:110, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.name}</div>
        </div>
      </div>
    ),
  };

  const priceCol: Col = {
    key:"price", label:"Price", right:true,
    render:(r)=><span style={{ display:"inline-flex", alignItems:"center", justifyContent:"flex-end", gap:5 }}>
      <span style={{ fontWeight:600, fontVariantNumeric:"tabular-nums" }}>${r.price.toFixed(2)}</span>
      {r.priceSource === "tastytrade-live" && (
        <span title="Tastytrade live quote" style={{ width:6, height:6, borderRadius:"50%", background:"#30d158", boxShadow:"0 0 0 2px rgba(48,209,88,0.16)" }} />
      )}
      {r.priceSource === "tastytrade-rest" && (
        <span title="Tastytrade quote" style={{ width:6, height:6, borderRadius:"50%", background:"#ffd60a", boxShadow:"0 0 0 2px rgba(255,214,10,0.14)" }} />
      )}
    </span>,
  };

  const changeCol: Col = {
    key:"changePercent", label:"Change %", right:true,
    render:(r)=>{
      const up=r.changePercent>=0;
      return <span style={{ color:up?"#30d158":"#ff453a", fontWeight:600, fontVariantNumeric:"tabular-nums" }}>{up?"+":""}{r.changePercent.toFixed(2)}%</span>;
    },
  };

  const TAB_COLS: Record<TabKey, Col[]> = {
    overview: [
      baseCol, priceCol, changeCol,
      { key:"volume",    label:"Volume",    right:true, render:r=><span style={{ color:"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>{fmtVol(r.volume)}</span> },
      { key:"relVol",    label:"Rel Vol",   right:true, render:r=><span style={{ color:r.relVol>3?"#ff9f0a":r.relVol>2?"#ffd60a":"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>{r.relVol.toFixed(2)}×</span> },
      { key:"marketCap", label:"Mkt Cap",   right:true, render:r=><span style={{ color:"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>{r.marketCap > 0 ? fmtBig(r.marketCap) : "—"}</span> },
      { key:"sector",    label:"Sector",               render:r=>settings.showSectorBadge ? (
        <span style={{ padding:"2px 7px", borderRadius:4, fontSize:10, fontWeight:600, color:"hsl(var(--primary))", background:"hsl(var(--primary) / 0.10)" }}>{r.sector}</span>
      ) : <span style={{ fontSize:10, color:"rgba(255,255,255,0.45)" }}>{r.sector}</span> },
      { key:"beta",      label:"Beta",      right:true, render:r=><span style={{ color:"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>{r.beta.toFixed(2)}</span> },
      { key:"recommendedOutlook", label:"Outlook", render:r=>(
        settings.showOutlookBadge ? <span style={{ padding:"2px 7px", borderRadius:4, fontSize:10, fontWeight:600,
          background: r.recommendedOutlook==="bullish"?"rgba(48,209,88,0.12)":r.recommendedOutlook==="bearish"?"rgba(255,69,58,0.12)":"rgba(255,255,255,0.06)",
          color: r.recommendedOutlook==="bullish"?"#30d158":r.recommendedOutlook==="bearish"?"#ff453a":"rgba(255,255,255,0.4)",
        }}>{r.recommendedOutlook||"—"}</span> : <span style={{ fontSize:10, color:"rgba(255,255,255,0.45)" }}>{r.recommendedOutlook||"—"}</span>
      )},
      { key:"opportunityScore", label:"Score", right:true, render:r=>{
        const color = r.opportunityScore>=70?"#30d158":r.opportunityScore>=50?"#ffd60a":"rgba(255,255,255,0.45)";
        return settings.showConvictionBadges
          ? <span title={scoreTitle(r)} style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", minWidth:32, height:20, borderRadius:5, color, background:`${color}20`, border:`1px solid ${color}44`, fontVariantNumeric:"tabular-nums", fontWeight:700 }}>{r.opportunityScore.toFixed(0)}</span>
          : <span title={scoreTitle(r)} style={{ color, fontVariantNumeric:"tabular-nums", fontWeight:600 }}>{r.opportunityScore.toFixed(0)}</span>;
      }},
    ],
    performance: [
      baseCol, priceCol, changeCol,
      { key:"pctFrom52High", label:"% 52W High", right:true, render:r=><span style={{ color:r.pctFrom52High>-5?"#30d158":r.pctFrom52High>-20?"#ffd60a":"#ff453a", fontVariantNumeric:"tabular-nums" }}>{r.pctFrom52High.toFixed(1)}%</span> },
      { key:"pctFrom52Low",  label:"% 52W Low",  right:true, render:r=><span style={{ color:"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>+{r.pctFrom52Low.toFixed(1)}%</span> },
      { key:"fiftyTwoWeekHigh", label:"52W High", right:true, render:r=><span style={{ color:"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>${r.fiftyTwoWeekHigh.toFixed(2)}</span> },
      { key:"fiftyTwoWeekLow",  label:"52W Low",  right:true, render:r=><span style={{ color:"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>${r.fiftyTwoWeekLow.toFixed(2)}</span> },
      { key:"volume",    label:"Volume",    right:true, render:r=><span style={{ color:"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>{fmtVol(r.volume)}</span> },
      { key:"relVol",    label:"Rel Vol",   right:true, render:r=><span style={{ color:r.relVol>3?"#ff9f0a":r.relVol>2?"#ffd60a":"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>{r.relVol.toFixed(2)}×</span> },
      { key:"marketCap", label:"Mkt Cap",   right:true, render:r=><span style={{ color:"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>{r.marketCap > 0 ? fmtBig(r.marketCap) : "—"}</span> },
      { key:"beta",      label:"Beta",      right:true, render:r=><span style={{ color:"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>{r.beta.toFixed(2)}</span> },
    ],
    technicals: [
      baseCol, priceCol, changeCol,
      { key:"rsi14",          label:"RSI (14)",     right:true, render:r=><span style={{ color:r.rsi14>70?"#ff453a":r.rsi14<30?"#30d158":"rgba(255,255,255,0.7)", fontWeight:600, fontVariantNumeric:"tabular-nums" }}>{r.rsi14.toFixed(1)}</span> },
      { key:"macdHistogram",  label:"MACD Hist",    right:true, render:r=><span style={{ color:r.macdHistogram>0?"#30d158":"#ff453a", fontVariantNumeric:"tabular-nums" }}>{r.macdHistogram.toFixed(3)}</span> },
      { key:"technicalStrength", label:"Tech Str",  right:true, render:r=>{
        const v=r.technicalStrength;
        const c=v>=8?"#30d158":v>=6?"#ffd60a":v>=4?"#ff9f0a":"#ff453a";
        return <span style={{ color:c, fontWeight:600, fontVariantNumeric:"tabular-nums" }}>{v.toFixed(1)}/10</span>;
      }},
      { key:"relVol",         label:"Rel Vol",      right:true, render:r=><span style={{ color:r.relVol>3?"#ff9f0a":r.relVol>2?"#ffd60a":"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>{r.relVol.toFixed(2)}×</span> },
      { key:"pctFrom52High",  label:"vs 52W High",  right:true, render:r=><span style={{ color:r.pctFrom52High>-5?"#30d158":r.pctFrom52High>-20?"#ffd60a":"#ff453a", fontVariantNumeric:"tabular-nums" }}>{r.pctFrom52High.toFixed(1)}%</span> },
      { key:"beta",           label:"Beta",         right:true, render:r=><span style={{ color:"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>{r.beta.toFixed(2)}</span> },
      { key:"setupType", label:"Setup", render:r=><span style={{ fontSize:10, color:"rgba(255,255,255,0.4)" }}>{r.setupType}</span> },
    ],
    fundamentals: [
      baseCol, priceCol,
      { key:"marketCap",    label:"Mkt Cap",      right:true, render:r=><span style={{ color:"rgba(255,255,255,0.6)", fontVariantNumeric:"tabular-nums" }}>{fmtBig(r.marketCap)}</span> },
      { key:"pe",           label:"P/E",          right:true, render:r=><span style={{ color:"rgba(255,255,255,0.7)", fontVariantNumeric:"tabular-nums" }}>{r.pe>0?r.pe.toFixed(1):"—"}</span> },
      { key:"forwardPE",    label:"Fwd P/E",      right:true, render:r=><span style={{ color:"rgba(255,255,255,0.7)", fontVariantNumeric:"tabular-nums" }}>{r.forwardPE>0?r.forwardPE.toFixed(1):"—"}</span> },
      { key:"eps",          label:"EPS",          right:true, render:r=><span style={{ color:r.eps>0?"#30d158":r.eps<0?"#ff453a":"rgba(255,255,255,0.5)", fontVariantNumeric:"tabular-nums" }}>{r.eps>0?"+":""}{r.eps.toFixed(2)}</span> },
      { key:"dividendYield",label:"Div Yield %",  right:true, render:r=><span style={{ color:r.dividendYield>0?"#ffd60a":"rgba(255,255,255,0.35)", fontVariantNumeric:"tabular-nums" }}>{r.dividendYield>0?`${r.dividendYield.toFixed(2)}%`:"—"}</span> },
      { key:"shortRatio",   label:"Short Ratio",  right:true, render:r=><span style={{ color:r.shortRatio>7?"#ff453a":r.shortRatio>4?"#ff9f0a":"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>{r.shortRatio>0?`${r.shortRatio.toFixed(1)}d`:"—"}</span> },
      { key:"priceTarget",  label:"Price Target", right:true, render:r=>{
        if (!r.priceTarget) return <span style={{ color:"rgba(255,255,255,0.25)" }}>—</span>;
        const up=r.priceTarget>r.price;
        return <span style={{ color:up?"#30d158":"#ff453a", fontVariantNumeric:"tabular-nums" }}>${r.priceTarget.toFixed(2)}</span>;
      }},
      { key:"recommendation",label:"Analyst Rating", render:r=>{
        const v=r.recommendation;
        if (!v) return <span style={{ color:"rgba(255,255,255,0.25)" }}>—</span>;
        const label=v<=1.5?"Strong Buy":v<=2?"Buy":v<=2.5?"Outperform":v<=3?"Hold":v<=3.5?"Underperform":"Sell";
        const color=v<=2?"#30d158":v<=2.8?"#ffd60a":v<=3.5?"#ff9f0a":"#ff453a";
        return <span style={{ fontSize:10, color, fontWeight:600 }}>{label}</span>;
      }},
    ],
    options: [
      baseCol, priceCol, changeCol,
      { key:"ivRank",         label:"IV Rank",      right:true, render:r=>{
        const high = settings.highlightHighIvStocks && r.ivRank >= settings.highIvHighlightThreshold;
        return <span style={{
          color:high?"#ff9f0a":r.ivRank>50?"#ffd60a":"rgba(255,255,255,0.55)",
          fontWeight:high||r.ivRank>50?700:400,
          fontVariantNumeric:"tabular-nums",
          padding:high?"2px 6px":0,
          borderRadius:high?4:0,
          background:high?"rgba(255,159,10,0.12)":undefined,
          border:high?"1px solid rgba(255,159,10,0.24)":undefined,
        }}>{r.ivRank.toFixed(0)}</span>;
      } },
      { key:"opportunityScore",label:"Opp Score",   right:true, render:r=>{
        const c=r.opportunityScore>=70?"#30d158":r.opportunityScore>=50?"#ffd60a":"rgba(255,255,255,0.45)";
        return <span title={scoreTitle(r)} style={{ color:c, fontVariantNumeric:"tabular-nums", fontWeight:600 }}>{r.opportunityScore.toFixed(0)}</span>;
      }},
      { key:"setupType",      label:"Setup",                   render:r=><span style={{ fontSize:10, color:"rgba(255,255,255,0.45)" }}>{r.setupType}</span> },
      { key:"recommendedOutlook", label:"Outlook",             render:r=>(
        settings.showOutlookBadge ? <span style={{ padding:"2px 7px", borderRadius:4, fontSize:10, fontWeight:600,
          background: r.recommendedOutlook==="bullish"?"rgba(48,209,88,0.12)":r.recommendedOutlook==="bearish"?"rgba(255,69,58,0.12)":"rgba(255,255,255,0.06)",
          color: r.recommendedOutlook==="bullish"?"#30d158":r.recommendedOutlook==="bearish"?"#ff453a":"rgba(255,255,255,0.4)",
        }}>{r.recommendedOutlook||"—"}</span> : <span style={{ fontSize:10, color:"rgba(255,255,255,0.45)" }}>{r.recommendedOutlook||"—"}</span>
      )},
      { key:"relVol",         label:"Rel Vol",      right:true, render:r=><span style={{ color:r.relVol>3?"#ff9f0a":r.relVol>2?"#ffd60a":"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>{r.relVol.toFixed(2)}×</span> },
      { key:"beta",           label:"Beta",         right:true, render:r=><span style={{ color:"rgba(255,255,255,0.55)", fontVariantNumeric:"tabular-nums" }}>{r.beta.toFixed(2)}</span> },
    ],
    factors: [
      baseCol, priceCol, changeCol,
      { key:"fMomentum",  label:"Momentum",  right:false, render:r=><FactorBar value={r.fMomentum}  color="#0a84ff" /> },
      { key:"fValue",     label:"Value",     right:false, render:r=><FactorBar value={r.fValue}     color="#30d158" /> },
      { key:"fQuality",   label:"Quality",   right:false, render:r=><FactorBar value={r.fQuality}   color="#bf5af2" /> },
      { key:"fVolatility",label:"Vol Rank",  right:false, render:r=><FactorBar value={r.fVolatility} color="#ff9f0a" /> },
      { key:"fOptions",   label:"Options",   right:false, render:r=><FactorBar value={r.fOptions}   color="#ff375f" /> },
      { key:"alpha",      label:"Alpha Score", right:true, render:r=><AlphaBadge v={r.alpha} /> },
    ],
  };

  const cols = (TAB_COLS[tab] ?? TAB_COLS.overview)
    .filter((col) => isVisible(col.key))
    .filter((col) => settings.showSetupTypeBadge || col.key !== "setupType")
    .filter((col) => settings.showRecommendationBadge || col.key !== "recommendation");
  const visibleRows = rows.slice(0, settings.screenerRowsPerPage);

  const TH = ({ col }: { col: Col }) => (
    <th onClick={()=>onSort(col.key)} style={{
      padding:headerPadding, fontSize:10, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase",
      color: sortKey===col.key ? "#0a84ff" : "rgba(255,255,255,0.3)",
      textAlign: col.right ? "right" : "left", cursor:"pointer", userSelect:"none", whiteSpace:"nowrap",
      position:"sticky", top:0, background:"#111", zIndex:2,
      borderBottom:"1px solid rgba(255,255,255,0.06)",
      width: col.width,
    }}>
      {col.label}{sortKey===col.key?(sortDir==="desc"?" ↓":" ↑"):""}
    </th>
  );

  return (
    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
      <thead>
        <tr>
          {cols.map(c=><TH key={c.key} col={c} />)}
          <th style={{ padding:"7px 8px", fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.2)", textAlign:"right", position:"sticky", top:0, background:"#111", zIndex:2, borderBottom:"1px solid rgba(255,255,255,0.06)", width:36 }}>WL</th>
        </tr>
      </thead>
      <tbody>
        {visibleRows.map((r,i)=>(
          <tr key={r.symbol}
            onClick={()=>navigate(`/scanner?symbol=${r.symbol}`)}
            style={{ borderBottom:"1px solid rgba(255,255,255,0.035)", background:i%2?"rgba(255,255,255,0.01)":"transparent", cursor:"pointer" }}
            onMouseEnter={e=>(e.currentTarget.style.background="rgba(10,132,255,0.05)")}
            onMouseLeave={e=>(e.currentTarget.style.background=i%2?"rgba(255,255,255,0.01)":"transparent")}
          >
            {cols.map(c=>(
              <td key={c.key} style={{ padding:rowPadding, textAlign:c.right?"right":"left" }}>
                {c.render(r)}
              </td>
            ))}
            <td style={{ padding:"4px 8px", textAlign:"right" }}>
              <button
                onClick={(e) => onWatchlistToggle(r.symbol, e)}
                title={watchlistSymbolMap.has(r.symbol) ? "Remove from watchlist" : "Add to watchlist"}
                style={{
                  width:24, height:24, borderRadius:5, border:"none",
                  background: watchlistSymbolMap.has(r.symbol) ? "rgba(10,132,255,0.18)" : "rgba(255,255,255,0.05)",
                  color: watchlistSymbolMap.has(r.symbol) ? "#0a84ff" : "rgba(255,255,255,0.3)",
                  cursor:"pointer", fontSize:12, display:"inline-flex", alignItems:"center", justifyContent:"center",
                  transition:"all 0.12s",
                }}
              >
                {watchlistSymbolMap.has(r.symbol) ? "★" : "☆"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Mini components ──────────────────────────────────────────────────────────

function FactorBar({ value, color }: { value:number; color:string }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5 }}>
      <div style={{ width:44, height:3, background:"rgba(255,255,255,0.08)", borderRadius:2, overflow:"hidden" }}>
        <div style={{ width:`${value}%`, height:"100%", background:color, borderRadius:2 }} />
      </div>
      <span style={{ fontSize:10, fontVariantNumeric:"tabular-nums", color:"rgba(255,255,255,0.45)", width:22, textAlign:"right" }}>{value}</span>
    </div>
  );
}

function AlphaBadge({ v }: { v:number }) {
  const c = v>=70?"#30d158":v>=50?"#ffd60a":v>=30?"#ff9f0a":"#ff453a";
  return (
    <div style={{
      display:"inline-flex", alignItems:"center", justifyContent:"center",
      width:36, height:20, borderRadius:5, fontWeight:700, fontSize:11,
      fontVariantNumeric:"tabular-nums", background:`${c}22`, border:`1px solid ${c}44`, color:c,
    }}>{v}</div>
  );
}
