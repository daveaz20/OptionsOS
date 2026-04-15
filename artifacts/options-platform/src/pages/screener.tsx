import { useState, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScreenerRow {
  symbol: string; name: string; price: number; change: number; changePercent: number;
  volume: number; avgVolume: number; relVol: number; marketCap: number; sector: string;
  beta: number; pe: number; forwardPE: number; eps: number; dividendYield: number;
  shortRatio: number; priceTarget: number; recommendation: number;
  fiftyTwoWeekHigh: number; fiftyTwoWeekLow: number;
  pctFrom52High: number; pctFrom52Low: number; earningsDate: string;
  technicalStrength: number; rsi14: number; macdHistogram: number; ivRank: number;
  opportunityScore: number; setupType: string; recommendedOutlook: string;
  supportPrice: number; resistancePrice: number; liquidity: string;
}

interface FactoredRow extends ScreenerRow {
  fMomentum: number; fValue: number; fQuality: number; fVolatility: number; fOptions: number;
  alpha: number;
}

type ViewMode = "table" | "heatmap" | "scatter";
type Weights = { momentum: number; value: number; quality: number; volatility: number; options: number };

interface Filters {
  sector: string;
  marketCap: string;        // "any" | "small" | "mid" | "large" | "mega"
  priceMin: string;
  priceMax: string;
  changeMin: string;
  changeMax: string;
  relVolMin: string;
  rsiMin: string;
  rsiMax: string;
  ivRankMin: string;
  peMax: string;
  divYieldMin: string;
  betaMax: string;
  outlook: string;          // "any" | "bullish" | "bearish" | "neutral"
  alphaMin: string;
  shortRatioMin: string;
  technicalMin: string;
}

const DEFAULT_FILTERS: Filters = {
  sector: "", marketCap: "any", priceMin: "", priceMax: "",
  changeMin: "", changeMax: "", relVolMin: "", rsiMin: "", rsiMax: "",
  ivRankMin: "", peMax: "", divYieldMin: "", betaMax: "",
  outlook: "any", alphaMin: "", shortRatioMin: "", technicalMin: "",
};

// ─── Presets ─────────────────────────────────────────────────────────────────

const PRESETS = [
  {
    label: "All",
    icon: "⬛",
    filters: DEFAULT_FILTERS,
  },
  {
    label: "Options Seller",
    icon: "💰",
    filters: { ...DEFAULT_FILTERS, ivRankMin: "65", marketCap: "mid" },
  },
  {
    label: "Momentum",
    icon: "🚀",
    filters: { ...DEFAULT_FILTERS, changeMin: "1", technicalMin: "7", rsiMin: "55" },
  },
  {
    label: "High Volume",
    icon: "⚡",
    filters: { ...DEFAULT_FILTERS, relVolMin: "2" },
  },
  {
    label: "Value Plays",
    icon: "💎",
    filters: { ...DEFAULT_FILTERS, peMax: "20", divYieldMin: "1" },
  },
  {
    label: "Bullish Setup",
    icon: "📈",
    filters: { ...DEFAULT_FILTERS, outlook: "bullish", technicalMin: "6" },
  },
  {
    label: "Short Squeeze",
    icon: "🎯",
    filters: { ...DEFAULT_FILTERS, shortRatioMin: "5", changeMin: "1" },
  },
  {
    label: "Low Beta",
    icon: "🛡️",
    filters: { ...DEFAULT_FILTERS, betaMax: "0.8", outlook: "bullish" },
  },
];

// ─── Factor Engine ────────────────────────────────────────────────────────────

function pctRank(arr: number[], val: number): number {
  if (arr.length === 0) return 50;
  return Math.min(99, Math.round((arr.filter(v => v < val).length / arr.length) * 100));
}

function computeFactors(rows: ScreenerRow[], w: Weights): FactoredRow[] {
  if (rows.length === 0) return [];
  const chg = rows.map(r => r.changePercent);
  const tech = rows.map(r => r.technicalStrength);
  const rsi  = rows.map(r => r.rsi14);
  const mcap = rows.map(r => Math.log1p(r.marketCap));
  const peLow = rows.map(r => r.pe > 0 ? -r.pe : -999);
  const fwdLow = rows.map(r => r.forwardPE > 0 ? -r.forwardPE : -999);
  const divY = rows.map(r => r.dividendYield);
  const p52lo = rows.map(r => r.pctFrom52Low);
  const recInv = rows.map(r => -(r.recommendation));
  const ivR = rows.map(r => r.ivRank);
  const opp = rows.map(r => r.opportunityScore);
  const rv = rows.map(r => Math.min(r.relVol, 10));
  const betaS = rows.map(r => -r.beta);

  return rows.map((r, i) => {
    const fMomentum = Math.round(pctRank(chg,chg[i])*0.35 + pctRank(tech,tech[i])*0.40 + pctRank(rsi,rsi[i])*0.25);
    const fValue    = Math.round(pctRank(peLow,peLow[i])*0.35 + pctRank(fwdLow,fwdLow[i])*0.25 + pctRank(divY,divY[i])*0.20 + pctRank(p52lo,p52lo[i])*0.20);
    const fQuality  = Math.round(pctRank(mcap,mcap[i])*0.35 + pctRank(recInv,recInv[i])*0.35 + pctRank(betaS,betaS[i])*0.30);
    const fVolatility = pctRank(ivR, ivR[i]);
    const fOptions  = Math.round(pctRank(opp,opp[i])*0.60 + pctRank(rv,Math.min(r.relVol,10))*0.40);
    const total = w.momentum + w.value + w.quality + w.volatility + w.options;
    const alpha = total > 0
      ? Math.round((fMomentum*w.momentum + fValue*w.value + fQuality*w.quality + fVolatility*w.volatility + fOptions*w.options) / total)
      : 50;
    return { ...r, fMomentum, fValue, fQuality, fVolatility, fOptions, alpha };
  });
}

// ─── Apply Filters ────────────────────────────────────────────────────────────

function applyFilters(rows: FactoredRow[], f: Filters): FactoredRow[] {
  return rows.filter(r => {
    if (f.sector && r.sector !== f.sector) return false;
    if (f.outlook !== "any" && r.recommendedOutlook !== f.outlook) return false;
    if (f.marketCap !== "any") {
      const mc = r.marketCap;
      if (f.marketCap === "small" && !(mc >= 300e6 && mc < 2e9))  return false;
      if (f.marketCap === "mid"   && !(mc >= 2e9  && mc < 10e9))  return false;
      if (f.marketCap === "large" && !(mc >= 10e9 && mc < 200e9)) return false;
      if (f.marketCap === "mega"  && !(mc >= 200e9))               return false;
    }
    if (f.priceMin    && r.price         < +f.priceMin)    return false;
    if (f.priceMax    && r.price         > +f.priceMax)    return false;
    if (f.changeMin   && r.changePercent < +f.changeMin)   return false;
    if (f.changeMax   && r.changePercent > +f.changeMax)   return false;
    if (f.relVolMin   && r.relVol        < +f.relVolMin)   return false;
    if (f.rsiMin      && r.rsi14         < +f.rsiMin)      return false;
    if (f.rsiMax      && r.rsi14         > +f.rsiMax)      return false;
    if (f.ivRankMin   && r.ivRank        < +f.ivRankMin)   return false;
    if (f.peMax       && r.pe > 0 && r.pe > +f.peMax)     return false;
    if (f.divYieldMin && r.dividendYield < +f.divYieldMin) return false;
    if (f.betaMax     && r.beta          > +f.betaMax)     return false;
    if (f.alphaMin    && r.alpha         < +f.alphaMin)    return false;
    if (f.shortRatioMin && r.shortRatio  < +f.shortRatioMin) return false;
    if (f.technicalMin  && r.technicalStrength < +f.technicalMin) return false;
    return true;
  });
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtBig = (n: number) => {
  if (n >= 1e12) return `$${(n/1e12).toFixed(1)}T`;
  if (n >= 1e9)  return `$${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n/1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
};
const fmtVol = (n: number) => {
  if (n >= 1e9) return `${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`;
  return String(n);
};

// ─── Mini components ──────────────────────────────────────────────────────────

function FactorBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
      <div style={{ width:40, height:3, background:"rgba(255,255,255,0.08)", borderRadius:2, overflow:"hidden" }}>
        <div style={{ width:`${value}%`, height:"100%", background:color, borderRadius:2 }} />
      </div>
      <span style={{ fontSize:10, fontVariantNumeric:"tabular-nums", color:"rgba(255,255,255,0.5)", width:20, textAlign:"right" }}>{value}</span>
    </div>
  );
}

function AlphaBadge({ v }: { v: number }) {
  const c = v >= 70 ? "#30d158" : v >= 50 ? "#ffd60a" : v >= 30 ? "#ff9f0a" : "#ff453a";
  return (
    <div style={{
      display:"inline-flex",alignItems:"center",justifyContent:"center",
      width:36,height:20,borderRadius:5,fontWeight:700,fontSize:11,
      fontVariantNumeric:"tabular-nums",background:`${c}22`,border:`1px solid ${c}44`,color:c,
    }}>{v}</div>
  );
}

function FilterInput({ label, placeholder, value, onChange, min, max, step }: {
  label: string; placeholder?: string; value: string;
  onChange: (v: string) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <input type="number" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? "Any"}
        min={min} max={max} step={step}
        style={{
          width: "100%", background: "rgba(255,255,255,0.06)",
          border: value ? "1px solid rgba(10,132,255,0.4)" : "1px solid rgba(255,255,255,0.09)",
          borderRadius: 6, padding: "5px 8px", color: "#fff", fontSize: 12,
          fontVariantNumeric: "tabular-nums", boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function FilterRange({ label, minVal, maxVal, onMinChange, onMaxChange, minPlaceholder, maxPlaceholder }: {
  label: string; minVal: string; maxVal: string;
  onMinChange: (v: string) => void; onMaxChange: (v: string) => void;
  minPlaceholder?: string; maxPlaceholder?: string;
}) {
  const active = minVal || maxVal;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ display: "flex", gap: 4 }}>
        {[
          { val: minVal, onChange: onMinChange, ph: minPlaceholder ?? "Min" },
          { val: maxVal, onChange: onMaxChange, ph: maxPlaceholder ?? "Max" },
        ].map(({ val, onChange, ph }) => (
          <input key={ph} type="number" value={val} onChange={e => onChange(e.target.value)}
            placeholder={ph}
            style={{
              flex: 1, background: "rgba(255,255,255,0.06)",
              border: val ? "1px solid rgba(10,132,255,0.4)" : "1px solid rgba(255,255,255,0.09)",
              borderRadius: 6, padding: "5px 6px", color: "#fff", fontSize: 11,
              fontVariantNumeric: "tabular-nums", minWidth: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        width: "100%", background: value && value !== "any" && value !== "" ? "rgba(10,132,255,0.12)" : "rgba(255,255,255,0.06)",
        border: value && value !== "any" && value !== "" ? "1px solid rgba(10,132,255,0.4)" : "1px solid rgba(255,255,255,0.09)",
        borderRadius: 6, padding: "5px 8px", color: value && value !== "any" && value !== "" ? "#fff" : "rgba(255,255,255,0.45)",
        fontSize: 12, cursor: "pointer", boxSizing: "border-box",
      }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useScreenerData() {
  return useQuery<ScreenerRow[]>({
    queryKey: ["screener-v2"],
    queryFn: async () => {
      const res = await fetch("/api/screener");
      if (!res.ok) throw new Error("screener fetch failed");
      return res.json();
    },
    staleTime: 3*60*1000, gcTime: 10*60*1000, retry: 2,
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: Weights = { momentum: 20, value: 20, quality: 20, volatility: 20, options: 20 };

export default function Screener() {
  const [, setLocation] = useLocation();
  const { data: raw = [], isLoading, isFetching } = useScreenerData();

  const [view,    setView]    = useState<ViewMode>("table");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState("alpha");
  const [sortDir, setSortDir] = useState<"desc"|"asc">("desc");
  const [xAxis,   setXAxis]   = useState("fMomentum");
  const [yAxis,   setYAxis]   = useState("fValue");
  const [heatFactor, setHeatFactor] = useState("alpha");
  const [activePreset, setActivePreset] = useState("All");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const setF = (key: keyof Filters) => (val: string) =>
    setFilters(f => ({ ...f, [key]: val }));

  const factored = useMemo(() => computeFactors(raw, DEFAULT_WEIGHTS), [raw]);

  const sectors = useMemo(() => {
    const s = new Set(factored.map(r => r.sector).filter(Boolean));
    return [...s].sort();
  }, [factored]);

  const filtered = useMemo(() => applyFilters(factored, filters), [factored, filters]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const va = (a as any)[sortKey] ?? 0, vb = (b as any)[sortKey] ?? 0;
      return sortDir === "desc" ? vb - va : va - vb;
    });
  }, [filtered, sortKey, sortDir]);

  const onSort = (k: string) => {
    if (sortKey === k) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  const applyPreset = (p: typeof PRESETS[0]) => {
    setFilters(p.filters);
    setActivePreset(p.label);
  };

  const resetFilters = () => { setFilters(DEFAULT_FILTERS); setActivePreset("All"); };

  const activeFilterCount = Object.entries(filters).filter(([k, v]) =>
    v !== "" && v !== "any" && v !== DEFAULT_FILTERS[k as keyof Filters]
  ).length;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#0a0a0a", color:"#fff", fontFamily:"Inter,system-ui,sans-serif", overflow:"hidden" }}>

      {/* ── Top bar ── */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 16px", borderBottom:"1px solid rgba(255,255,255,0.06)", flexShrink:0, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, letterSpacing:"-0.02em" }}>Screener</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.38)", marginTop:1 }}>
            {isLoading ? "Loading…" : `${filtered.length.toLocaleString()} results · ${raw.length.toLocaleString()} stocks · ${isFetching?"Refreshing…":"Live"}`}
          </div>
        </div>
        <div style={{ flex:1 }} />

        {/* View toggle */}
        <div style={{ display:"flex", background:"rgba(255,255,255,0.05)", borderRadius:7, padding:2, gap:1 }}>
          {(["table","heatmap","scatter"] as ViewMode[]).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding:"4px 11px", borderRadius:5, border:"none",
              background: view===v ? "rgba(10,132,255,0.25)" : "transparent",
              color: view===v ? "#0a84ff" : "rgba(255,255,255,0.45)",
              fontSize:11, fontWeight:600, cursor:"pointer",
            }}>
              {v === "table" ? "Table" : v === "heatmap" ? "Sector Map" : "Scatter"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Preset bar ── */}
      <div style={{ display:"flex", gap:6, padding:"8px 16px", borderBottom:"1px solid rgba(255,255,255,0.06)", flexShrink:0, overflowX:"auto", alignItems:"center" }}>
        <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", whiteSpace:"nowrap", marginRight:2 }}>Quick screens:</span>
        {PRESETS.map(p => (
          <button key={p.label} onClick={() => applyPreset(p)} style={{
            padding:"4px 12px", borderRadius:20, border:"none", whiteSpace:"nowrap",
            background: activePreset===p.label ? "rgba(10,132,255,0.25)" : "rgba(255,255,255,0.06)",
            color: activePreset===p.label ? "#0a84ff" : "rgba(255,255,255,0.6)",
            fontSize:11, fontWeight:600, cursor:"pointer",
            borderWidth:1, borderStyle:"solid",
            borderColor: activePreset===p.label ? "rgba(10,132,255,0.4)" : "transparent",
          }}>
            {p.icon} {p.label}
          </button>
        ))}
        {activeFilterCount > 0 && (
          <button onClick={resetFilters} style={{ padding:"4px 10px", borderRadius:20, border:"1px solid rgba(255,69,58,0.3)", background:"rgba(255,69,58,0.1)", color:"#ff453a", fontSize:11, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap", marginLeft:"auto" }}>
            ✕ Clear filters ({activeFilterCount})
          </button>
        )}
      </div>

      {/* ── Body: sidebar + content ── */}
      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* ── Filter sidebar ── */}
        <div style={{
          width:200, flexShrink:0, borderRight:"1px solid rgba(255,255,255,0.06)",
          overflowY:"auto", padding:"12px 12px",
          scrollbarWidth:"thin", scrollbarColor:"rgba(255,255,255,0.1) transparent",
        }}>
          <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.3)", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:12 }}>Filters</div>

          {/* Sector */}
          <FilterSelect label="Sector" value={filters.sector || ""}
            onChange={v => setF("sector")(v)}
            options={[
              { value:"", label:"All Sectors" },
              ...sectors.map(s => ({ value:s, label:s })),
            ]}
          />

          {/* Market Cap */}
          <FilterSelect label="Market Cap" value={filters.marketCap}
            onChange={setF("marketCap")}
            options={[
              { value:"any",   label:"Any size" },
              { value:"small", label:"Small  (<$2B)" },
              { value:"mid",   label:"Mid  ($2–10B)" },
              { value:"large", label:"Large  ($10–200B)" },
              { value:"mega",  label:"Mega  (>$200B)" },
            ]}
          />

          {/* Outlook */}
          <FilterSelect label="Outlook" value={filters.outlook}
            onChange={setF("outlook")}
            options={[
              { value:"any",     label:"Any" },
              { value:"bullish", label:"📈 Bullish" },
              { value:"neutral", label:"◼ Neutral" },
              { value:"bearish", label:"📉 Bearish" },
            ]}
          />

          <div style={{ height:1, background:"rgba(255,255,255,0.06)", margin:"10px 0" }} />

          {/* Price */}
          <FilterRange label="Price ($)" minVal={filters.priceMin} maxVal={filters.priceMax}
            onMinChange={setF("priceMin")} onMaxChange={setF("priceMax")} />

          {/* 1D Change */}
          <FilterRange label="1D Change (%)" minVal={filters.changeMin} maxVal={filters.changeMax}
            onMinChange={setF("changeMin")} onMaxChange={setF("changeMax")}
            minPlaceholder="-10" maxPlaceholder="+10" />

          {/* Relative Volume */}
          <FilterInput label="Rel. Volume (min)" value={filters.relVolMin} onChange={setF("relVolMin")} placeholder="e.g. 1.5" />

          <div style={{ height:1, background:"rgba(255,255,255,0.06)", margin:"10px 0" }} />

          {/* RSI */}
          <FilterRange label="RSI (14)" minVal={filters.rsiMin} maxVal={filters.rsiMax}
            onMinChange={setF("rsiMin")} onMaxChange={setF("rsiMax")}
            minPlaceholder="0" maxPlaceholder="100" />

          {/* Technical Strength */}
          <FilterInput label="Tech Strength (min, 1–10)" value={filters.technicalMin} onChange={setF("technicalMin")} placeholder="e.g. 7" />

          <div style={{ height:1, background:"rgba(255,255,255,0.06)", margin:"10px 0" }} />

          {/* IV Rank */}
          <FilterInput label="IV Rank (min)" value={filters.ivRankMin} onChange={setF("ivRankMin")} placeholder="e.g. 50" />

          {/* Alpha Score */}
          <FilterInput label="Alpha Score (min)" value={filters.alphaMin} onChange={setF("alphaMin")} placeholder="e.g. 60" />

          <div style={{ height:1, background:"rgba(255,255,255,0.06)", margin:"10px 0" }} />

          {/* Fundamentals */}
          <FilterInput label="P/E Ratio (max)" value={filters.peMax} onChange={setF("peMax")} placeholder="e.g. 30" />
          <FilterInput label="Dividend Yield % (min)" value={filters.divYieldMin} onChange={setF("divYieldMin")} placeholder="e.g. 2" />
          <FilterInput label="Beta (max)" value={filters.betaMax} onChange={setF("betaMax")} placeholder="e.g. 1.5" />
          <FilterInput label="Short Ratio (min days)" value={filters.shortRatioMin} onChange={setF("shortRatioMin")} placeholder="e.g. 5" />
        </div>

        {/* ── Main content ── */}
        {isLoading ? (
          <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:12 }}>
            <div style={{ width:36, height:36, borderRadius:"50%", border:"2px solid rgba(10,132,255,0.2)", borderTopColor:"#0a84ff", animation:"spin 0.9s linear infinite" }} />
            <div style={{ color:"rgba(255,255,255,0.4)", fontSize:13 }}>Loading {raw.length || ""}  stocks…</div>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : (
          <div style={{ flex:1, overflow:"hidden" }}>
            {view === "table"   && <TableView   rows={sorted}   sortKey={sortKey} sortDir={sortDir} onSort={onSort}       navigate={setLocation} />}
            {view === "heatmap" && <HeatmapView rows={filtered} factor={heatFactor}                 setFactor={setHeatFactor} navigate={setLocation} />}
            {view === "scatter" && <ScatterView rows={filtered} xAxis={xAxis} yAxis={yAxis}         setXAxis={setXAxis} setYAxis={setYAxis}     navigate={setLocation} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Table View ───────────────────────────────────────────────────────────────

const FACTOR_AXES = [
  { key: "fMomentum",    label: "Momentum" },
  { key: "fValue",       label: "Value" },
  { key: "fQuality",     label: "Quality" },
  { key: "fVolatility",  label: "Volatility" },
  { key: "fOptions",     label: "Options Edge" },
  { key: "alpha",        label: "Alpha Score" },
  { key: "ivRank",       label: "IV Rank" },
  { key: "changePercent",label: "1D Change %" },
  { key: "relVol",       label: "Rel. Volume" },
  { key: "beta",         label: "Beta" },
  { key: "pe",           label: "P/E" },
  { key: "shortRatio",   label: "Short Ratio" },
  { key: "rsi14",        label: "RSI 14" },
];

function TableView({ rows, sortKey, sortDir, onSort, navigate }: {
  rows: FactoredRow[]; sortKey: string; sortDir:"asc"|"desc"; onSort:(k:string)=>void; navigate:(p:string)=>void;
}) {
  const TH = ({ k, label, r }: { k:string; label:string; r?:boolean }) => (
    <th onClick={() => onSort(k)} style={{
      padding:"7px 10px", fontSize:10, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase",
      color: sortKey===k ? "#0a84ff" : "rgba(255,255,255,0.35)",
      textAlign: r ? "right" : "left", cursor:"pointer", userSelect:"none", whiteSpace:"nowrap",
      position:"sticky", top:0, background:"#111", zIndex:2,
      borderBottom:"1px solid rgba(255,255,255,0.07)",
    }}>
      {label}{sortKey===k ? (sortDir==="desc" ? " ↓" : " ↑") : ""}
    </th>
  );

  return (
    <div style={{ height:"100%", overflow:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
        <thead>
          <tr>
            <TH k="symbol"        label="Symbol" />
            <TH k="price"         label="Price"    r />
            <TH k="changePercent" label="1D %"     r />
            <TH k="relVol"        label="Rel Vol"  r />
            <TH k="volume"        label="Volume"   r />
            <TH k="marketCap"     label="Mkt Cap"  r />
            <TH k="ivRank"        label="IV Rank"  r />
            <TH k="rsi14"         label="RSI"      r />
            <TH k="pe"            label="P/E"      r />
            <TH k="beta"          label="Beta"     r />
            <TH k="shortRatio"    label="Short"    r />
            <TH k="fMomentum"    label="Momentum" />
            <TH k="fValue"       label="Value" />
            <TH k="fQuality"     label="Quality" />
            <TH k="fVolatility"  label="Volatility" />
            <TH k="fOptions"     label="Options" />
            <TH k="alpha"        label="Score"    r />
            <TH k="setupType"    label="Setup" />
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 400).map((r, i) => {
            const up = r.changePercent >= 0;
            return (
              <tr key={r.symbol}
                onClick={() => navigate(`/scanner?symbol=${r.symbol}`)}
                style={{ borderBottom:"1px solid rgba(255,255,255,0.04)", background:i%2?"rgba(255,255,255,0.012)":"transparent", cursor:"pointer" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(10,132,255,0.06)")}
                onMouseLeave={e => (e.currentTarget.style.background = i%2?"rgba(255,255,255,0.012)":"transparent")}
              >
                {/* Symbol */}
                <td style={{ padding:"5px 10px", whiteSpace:"nowrap" }}>
                  <div style={{ fontWeight:700, fontSize:13 }}>{r.symbol}</div>
                  <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", maxWidth:100, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.name}</div>
                </td>
                {/* Price */}
                <td style={{ padding:"5px 10px", textAlign:"right", fontVariantNumeric:"tabular-nums", fontWeight:600 }}>
                  ${r.price.toFixed(2)}
                </td>
                {/* 1D % */}
                <td style={{ padding:"5px 10px", textAlign:"right", fontVariantNumeric:"tabular-nums", fontWeight:600, color:up?"#30d158":"#ff453a" }}>
                  {up?"+":""}{r.changePercent.toFixed(2)}%
                </td>
                {/* Rel Vol */}
                <td style={{ padding:"5px 10px", textAlign:"right", fontVariantNumeric:"tabular-nums", color:r.relVol>3?"#ff9f0a":r.relVol>2?"#ffd60a":"rgba(255,255,255,0.6)" }}>
                  {r.relVol.toFixed(2)}×
                </td>
                {/* Volume */}
                <td style={{ padding:"5px 10px", textAlign:"right", fontVariantNumeric:"tabular-nums", color:"rgba(255,255,255,0.5)" }}>
                  {fmtVol(r.volume)}
                </td>
                {/* Market Cap */}
                <td style={{ padding:"5px 10px", textAlign:"right", fontVariantNumeric:"tabular-nums", color:"rgba(255,255,255,0.5)" }}>
                  {fmtBig(r.marketCap)}
                </td>
                {/* IV Rank */}
                <td style={{ padding:"5px 10px", textAlign:"right", fontVariantNumeric:"tabular-nums", color:r.ivRank>70?"#ff9f0a":r.ivRank>50?"#ffd60a":"rgba(255,255,255,0.55)" }}>
                  {r.ivRank.toFixed(0)}
                </td>
                {/* RSI */}
                <td style={{ padding:"5px 10px", textAlign:"right", fontVariantNumeric:"tabular-nums", color:r.rsi14>70?"#ff453a":r.rsi14<30?"#30d158":"rgba(255,255,255,0.55)" }}>
                  {r.rsi14.toFixed(0)}
                </td>
                {/* P/E */}
                <td style={{ padding:"5px 10px", textAlign:"right", fontVariantNumeric:"tabular-nums", color:"rgba(255,255,255,0.55)" }}>
                  {r.pe > 0 ? r.pe.toFixed(1) : "—"}
                </td>
                {/* Beta */}
                <td style={{ padding:"5px 10px", textAlign:"right", fontVariantNumeric:"tabular-nums", color:"rgba(255,255,255,0.55)" }}>
                  {r.beta.toFixed(2)}
                </td>
                {/* Short Ratio */}
                <td style={{ padding:"5px 10px", textAlign:"right", fontVariantNumeric:"tabular-nums", color:r.shortRatio>7?"#ff453a":r.shortRatio>4?"#ff9f0a":"rgba(255,255,255,0.55)" }}>
                  {r.shortRatio > 0 ? `${r.shortRatio.toFixed(1)}d` : "—"}
                </td>
                {/* Factor bars */}
                <td style={{ padding:"5px 10px" }}><FactorBar value={r.fMomentum} color="#0a84ff" /></td>
                <td style={{ padding:"5px 10px" }}><FactorBar value={r.fValue}    color="#30d158" /></td>
                <td style={{ padding:"5px 10px" }}><FactorBar value={r.fQuality}  color="#bf5af2" /></td>
                <td style={{ padding:"5px 10px" }}><FactorBar value={r.fVolatility} color="#ff9f0a" /></td>
                <td style={{ padding:"5px 10px" }}><FactorBar value={r.fOptions}  color="#ff375f" /></td>
                {/* Alpha */}
                <td style={{ padding:"5px 10px", textAlign:"right" }}><AlphaBadge v={r.alpha} /></td>
                {/* Setup */}
                <td style={{ padding:"5px 10px" }}>
                  <span style={{
                    padding:"2px 6px", borderRadius:4, fontSize:10, fontWeight:600,
                    background: r.recommendedOutlook==="bullish"?"rgba(48,209,88,0.12)":r.recommendedOutlook==="bearish"?"rgba(255,69,58,0.12)":"rgba(255,255,255,0.06)",
                    color: r.recommendedOutlook==="bullish"?"#30d158":r.recommendedOutlook==="bearish"?"#ff453a":"rgba(255,255,255,0.4)",
                    whiteSpace:"nowrap",
                  }}>{r.setupType}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 400 && (
        <div style={{ padding:"10px 20px", color:"rgba(255,255,255,0.3)", fontSize:11, textAlign:"center" }}>
          Showing 400 of {rows.length.toLocaleString()} matches. Add more filters to narrow results.
        </div>
      )}
    </div>
  );
}

// ─── Heatmap View ─────────────────────────────────────────────────────────────

function HeatmapView({ rows, factor, setFactor, navigate }: {
  rows: FactoredRow[]; factor: string; setFactor:(f:string)=>void; navigate:(p:string)=>void;
}) {
  const bySector = useMemo(() => {
    const map = new Map<string, FactoredRow[]>();
    for (const r of rows) {
      const s = r.sector || "Other";
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(r);
    }
    return [...map.entries()].sort((a,b) => b[1].length - a[1].length);
  }, [rows]);

  const getV = (r: FactoredRow) => (r as any)[factor] ?? 50;

  const heatColor = (v: number) => {
    const signed = ["changePercent","macdHistogram","pctFrom52High","pctFrom52Low"];
    if (signed.includes(factor)) {
      if (v > 0) return `rgba(48,209,88,${Math.min(0.8, Math.abs(v)*0.12)})`;
      return `rgba(255,69,58,${Math.min(0.8, Math.abs(v)*0.12)})`;
    }
    const p = Math.max(0, Math.min(100, v));
    if (p >= 75) return "rgba(48,209,88,0.55)";
    if (p >= 60) return "rgba(48,209,88,0.28)";
    if (p >= 40) return "rgba(255,255,255,0.04)";
    if (p >= 25) return "rgba(255,69,58,0.22)";
    return "rgba(255,69,58,0.48)";
  };

  return (
    <div style={{ height:"100%", display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"8px 16px", display:"flex", gap:6, flexShrink:0, flexWrap:"wrap", borderBottom:"1px solid rgba(255,255,255,0.06)", alignItems:"center" }}>
        <span style={{ fontSize:10, color:"rgba(255,255,255,0.35)", marginRight:4 }}>Color by:</span>
        {FACTOR_AXES.map(a => (
          <button key={a.key} onClick={() => setFactor(a.key)} style={{
            padding:"3px 9px", borderRadius:5, fontSize:10, fontWeight:600, cursor:"pointer",
            background: factor===a.key ? "rgba(10,132,255,0.18)" : "rgba(255,255,255,0.05)",
            border: factor===a.key ? "1px solid rgba(10,132,255,0.35)" : "1px solid transparent",
            color: factor===a.key ? "#0a84ff" : "rgba(255,255,255,0.45)",
          }}>{a.label}</button>
        ))}
      </div>
      <div style={{ flex:1, overflow:"auto", padding:"14px 16px" }}>
        {bySector.map(([sec, stocks]) => (
          <div key={sec} style={{ marginBottom:18 }}>
            <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.35)", letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:7 }}>
              {sec} <span style={{ fontWeight:400, opacity:0.5 }}>({stocks.length})</span>
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
              {stocks.sort((a,b) => Math.abs(getV(b))-Math.abs(getV(a))).slice(0,60).map(r => {
                const v = getV(r);
                const area = Math.max(36, Math.min(80, 36 + (r.marketCap/6e11)*44));
                return (
                  <div key={r.symbol} onClick={() => navigate(`/scanner?symbol=${r.symbol}`)}
                    title={`${r.name}\n${FACTOR_AXES.find(a=>a.key===factor)?.label}: ${typeof v==="number"?v.toFixed(1):v}`}
                    style={{
                      width:area, height:area, background:heatColor(v), borderRadius:5,
                      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                      cursor:"pointer", border:"1px solid rgba(255,255,255,0.05)", transition:"transform 0.1s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform="scale(1.1)"; e.currentTarget.style.zIndex="5"; e.currentTarget.style.borderColor="rgba(10,132,255,0.5)"; }}
                    onMouseLeave={e => { e.currentTarget.style.transform="scale(1)"; e.currentTarget.style.zIndex="1"; e.currentTarget.style.borderColor="rgba(255,255,255,0.05)"; }}>
                    <span style={{ fontSize:Math.max(8,Math.min(11,area/7)), fontWeight:700 }}>{r.symbol}</span>
                    <span style={{ fontSize:9, opacity:0.65, fontVariantNumeric:"tabular-nums" }}>
                      {typeof v==="number" ? (Math.abs(v)<100 ? v.toFixed(1) : v.toFixed(0)) : v}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Scatter View ─────────────────────────────────────────────────────────────

function ScatterView({ rows, xAxis, yAxis, setXAxis, setYAxis, navigate }: {
  rows: FactoredRow[]; xAxis:string; yAxis:string;
  setXAxis:(s:string)=>void; setYAxis:(s:string)=>void; navigate:(p:string)=>void;
}) {
  const [tip, setTip] = useState<{x:number;y:number;row:FactoredRow}|null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const M = { t:16, r:16, b:38, l:44 };
  const W = 860, H = 500;
  const iW = W-M.l-M.r, iH = H-M.t-M.b;

  const gv = (r: FactoredRow, k: string) => { const v=(r as any)[k]; return typeof v==="number"?v:0; };

  const xVals = rows.map(r => gv(r, xAxis));
  const yVals = rows.map(r => gv(r, yAxis));
  const xMin = Math.min(...xVals,0), xMax = Math.max(...xVals,1);
  const yMin = Math.min(...yVals,0), yMax = Math.max(...yVals,1);

  const sx = (v:number) => ((v-xMin)/(xMax-xMin||1))*iW;
  const sy = (v:number) => iH - ((v-yMin)/(yMax-yMin||1))*iH;
  const xLbl = FACTOR_AXES.find(a=>a.key===xAxis)?.label ?? xAxis;
  const yLbl = FACTOR_AXES.find(a=>a.key===yAxis)?.label ?? yAxis;
  const dotC = (r:FactoredRow) => r.recommendedOutlook==="bullish"?"#30d158":r.recommendedOutlook==="bearish"?"#ff453a":"#0a84ff";
  const dotR = (r:FactoredRow) => Math.max(3, Math.min(9, Math.log10(r.marketCap/1e8+1)*2.2));

  return (
    <div style={{ height:"100%", display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"8px 16px", display:"flex", gap:14, alignItems:"center", flexShrink:0, borderBottom:"1px solid rgba(255,255,255,0.06)", flexWrap:"wrap" }}>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <span style={{ fontSize:10, color:"rgba(255,255,255,0.35)" }}>X axis:</span>
          <select value={xAxis} onChange={e=>setXAxis(e.target.value)} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.09)", color:"#fff", borderRadius:6, padding:"3px 7px", fontSize:10, cursor:"pointer" }}>
            {FACTOR_AXES.map(a=><option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <span style={{ fontSize:10, color:"rgba(255,255,255,0.35)" }}>Y axis:</span>
          <select value={yAxis} onChange={e=>setYAxis(e.target.value)} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.09)", color:"#fff", borderRadius:6, padding:"3px 7px", fontSize:10, cursor:"pointer" }}>
            {FACTOR_AXES.map(a=><option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:14, fontSize:10, color:"rgba(255,255,255,0.35)" }}>
          <span><span style={{ color:"#30d158" }}>●</span> Bullish</span>
          <span><span style={{ color:"#ff453a" }}>●</span> Bearish</span>
          <span><span style={{ color:"#0a84ff" }}>●</span> Neutral</span>
          <span>Size = market cap</span>
        </div>
      </div>
      <div style={{ flex:1, overflow:"hidden", padding:"6px 10px", position:"relative" }}>
        <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
          <g transform={`translate(${M.l},${M.t})`}>
            {[0,.25,.5,.75,1].map(f => (
              <g key={f}>
                <line x1={0} x2={iW} y1={f*iH} y2={f*iH} stroke="rgba(255,255,255,0.04)" strokeWidth={1}/>
                <line x1={f*iW} x2={f*iW} y1={0} y2={iH} stroke="rgba(255,255,255,0.04)" strokeWidth={1}/>
                <text x={f*iW} y={iH+14} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize={8}>{(xMin+f*(xMax-xMin)).toFixed(1)}</text>
                <text x={-5} y={iH-f*iH+3} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize={8}>{(yMin+f*(yMax-yMin)).toFixed(1)}</text>
              </g>
            ))}
            <text x={iW/2} y={iH+28} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize={10}>{xLbl}</text>
            <text x={-iH/2} y={-32} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize={10} transform="rotate(-90)">{yLbl}</text>
            {rows.slice(0,500).map(r => (
              <circle key={r.symbol}
                cx={sx(gv(r,xAxis))} cy={sy(gv(r,yAxis))} r={dotR(r)}
                fill={dotC(r)} fillOpacity={0.65} stroke="rgba(0,0,0,0.3)" strokeWidth={0.5}
                style={{ cursor:"pointer" }}
                onMouseEnter={e => {
                  const rect = svgRef.current?.getBoundingClientRect();
                  if (rect) setTip({ x:e.clientX-rect.left, y:e.clientY-rect.top, row:r });
                }}
                onMouseLeave={() => setTip(null)}
                onClick={() => navigate(`/scanner?symbol=${r.symbol}`)}
              />
            ))}
          </g>
        </svg>
        {tip && (
          <div style={{
            position:"absolute", left:tip.x+14, top:tip.y-8,
            background:"#1c1c1e", border:"1px solid rgba(255,255,255,0.12)",
            borderRadius:10, padding:"10px 14px", minWidth:160, pointerEvents:"none", zIndex:10,
          }}>
            <div style={{ fontWeight:700, fontSize:13 }}>{tip.row.symbol}</div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.45)", marginBottom:7 }}>{tip.row.name}</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"2px 10px", fontSize:10 }}>
              <span style={{ color:"rgba(255,255,255,0.4)" }}>{xLbl}</span><span style={{ fontVariantNumeric:"tabular-nums" }}>{gv(tip.row,xAxis).toFixed(1)}</span>
              <span style={{ color:"rgba(255,255,255,0.4)" }}>{yLbl}</span><span style={{ fontVariantNumeric:"tabular-nums" }}>{gv(tip.row,yAxis).toFixed(1)}</span>
              <span style={{ color:"rgba(255,255,255,0.4)" }}>Alpha</span><span style={{ fontVariantNumeric:"tabular-nums", color:"#0a84ff", fontWeight:700 }}>{tip.row.alpha}</span>
              <span style={{ color:"rgba(255,255,255,0.4)" }}>Price</span><span style={{ fontVariantNumeric:"tabular-nums" }}>${tip.row.price.toFixed(2)}</span>
              <span style={{ color:"rgba(255,255,255,0.4)" }}>IV Rank</span><span style={{ fontVariantNumeric:"tabular-nums" }}>{tip.row.ivRank.toFixed(0)}</span>
            </div>
            <div style={{ marginTop:6, fontSize:9, color:"rgba(10,132,255,0.7)" }}>Click → open in Analysis</div>
          </div>
        )}
      </div>
    </div>
  );
}
