import { useState, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
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

type Weights = { momentum: number; value: number; quality: number; volatility: number; options: number };
type ViewMode = "table" | "heatmap" | "scatter";

// ─── Constants ───────────────────────────────────────────────────────────────

const API_BASE = "/api";

const ALPHA_STRATEGIES = [
  { label: "Vol Crush Arb",      expr: "ivRank > 65 && opportunityScore > 60",                  desc: "High IV rank + earning setup" },
  { label: "Momentum Quality",   expr: "fMomentum > 70 && fQuality > 60",                       desc: "Strong trend + large cap" },
  { label: "Contrarian Value",   expr: "fMomentum < 35 && fValue > 70",                         desc: "Beaten down with value" },
  { label: "Institutional Flow", expr: "relVol > 3 && volume > 1000000",                        desc: "3× unusual volume spike" },
  { label: "Premium Seller",     expr: "ivRank > 70 && beta < 1.5",                             desc: "Sell premium in high vol" },
  { label: "Gamma Squeeze",      expr: "relVol > 2 && ivRank > 60 && changePercent > 2",        desc: "Vol surge + price move" },
  { label: "Short Squeeze",      expr: "shortRatio > 5 && changePercent > 1",                   desc: "High short + upward pressure" },
  { label: "Analyst Upgrade",    expr: "recommendation < 2.5 && pctFrom52High < -10",           desc: "Buy rating + below high" },
];

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

const DEFAULT_WEIGHTS: Weights = { momentum: 20, value: 20, quality: 20, volatility: 20, options: 20 };

// ─── Factor Engine (cross-sectional percentile ranking) ───────────────────────

function pctRank(arr: number[], val: number): number {
  if (arr.length === 0) return 50;
  const below = arr.filter(v => v < val).length;
  return Math.min(99, Math.round((below / arr.length) * 100));
}

function computeFactors(rows: ScreenerRow[], w: Weights): FactoredRow[] {
  if (rows.length === 0) return [];

  const chg    = rows.map(r => r.changePercent);
  const tech   = rows.map(r => r.technicalStrength);
  const rsi    = rows.map(r => r.rsi14);
  const mcap   = rows.map(r => Math.log1p(r.marketCap));
  const peLow  = rows.map(r => r.pe > 0 ? -r.pe : -999);
  const fwdLow = rows.map(r => r.forwardPE > 0 ? -r.forwardPE : -999);
  const divY   = rows.map(r => r.dividendYield);
  const p52lo  = rows.map(r => r.pctFrom52Low);
  const recInv = rows.map(r => -(r.recommendation));
  const ivR    = rows.map(r => r.ivRank);
  const opp    = rows.map(r => r.opportunityScore);
  const rv     = rows.map(r => Math.min(r.relVol, 10));
  const betaS  = rows.map(r => -r.beta);

  return rows.map((r, i) => {
    const fMomentum = Math.round(
      pctRank(chg,  chg[i])  * 0.35 +
      pctRank(tech, tech[i]) * 0.40 +
      pctRank(rsi,  rsi[i])  * 0.25
    );
    const fValue = Math.round(
      pctRank(peLow,  peLow[i])  * 0.35 +
      pctRank(fwdLow, fwdLow[i]) * 0.25 +
      pctRank(divY,   divY[i])   * 0.20 +
      pctRank(p52lo,  p52lo[i])  * 0.20
    );
    const fQuality = Math.round(
      pctRank(mcap,   mcap[i])   * 0.35 +
      pctRank(recInv, recInv[i]) * 0.35 +
      pctRank(betaS,  betaS[i])  * 0.30
    );
    const fVolatility = pctRank(ivR, ivR[i]);
    const fOptions = Math.round(
      pctRank(opp, opp[i]) * 0.60 +
      pctRank(rv,  Math.min(r.relVol, 10)) * 0.40
    );
    const total = w.momentum + w.value + w.quality + w.volatility + w.options;
    const alpha = total > 0
      ? Math.round((fMomentum * w.momentum + fValue * w.value + fQuality * w.quality + fVolatility * w.volatility + fOptions * w.options) / total)
      : 50;
    return { ...r, fMomentum, fValue, fQuality, fVolatility, fOptions, alpha };
  });
}

// ─── Expression Evaluator ─────────────────────────────────────────────────────

function evalExpr(expr: string, r: FactoredRow): boolean {
  try {
    const fn = new Function(
      "price","changePercent","relVol","volume","avgVolume","marketCap","beta",
      "pe","forwardPE","eps","dividendYield","shortRatio","priceTarget","recommendation",
      "pctFrom52High","pctFrom52Low","ivRank","opportunityScore","rsi14",
      "technicalStrength","macdHistogram","fMomentum","fValue","fQuality",
      "fVolatility","fOptions","alpha",
      `"use strict"; return !!(${expr});`
    );
    return fn(r.price,r.changePercent,r.relVol,r.volume,r.avgVolume,r.marketCap,r.beta,
      r.pe,r.forwardPE,r.eps,r.dividendYield,r.shortRatio,r.priceTarget,r.recommendation,
      r.pctFrom52High,r.pctFrom52Low,r.ivRank,r.opportunityScore,r.rsi14,
      r.technicalStrength,r.macdHistogram,r.fMomentum,r.fValue,r.fQuality,
      r.fVolatility,r.fOptions,r.alpha);
  } catch { return false; }
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
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <div style={{ width: 44, height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 10, fontVariantNumeric: "tabular-nums", color: "rgba(255,255,255,0.5)", width: 22, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function AlphaBadge({ v }: { v: number }) {
  const c = v >= 70 ? "#30d158" : v >= 50 ? "#ffd60a" : v >= 30 ? "#ff9f0a" : "#ff453a";
  return (
    <div style={{
      display:"inline-flex",alignItems:"center",justifyContent:"center",
      width:38,height:22,borderRadius:6,fontWeight:700,fontSize:12,
      fontVariantNumeric:"tabular-nums",
      background:`${c}22`,border:`1px solid ${c}44`,color:c,
    }}>{v}</div>
  );
}

function RadarMini({ r }: { r: FactoredRow }) {
  const vals = [r.fMomentum, r.fValue, r.fQuality, r.fVolatility, r.fOptions];
  const S = 28, cx = 14, cy = 14, rad = 11;
  const pts = vals.map((v,i) => {
    const a = (i/vals.length)*Math.PI*2 - Math.PI/2;
    const rr = (v/100)*rad;
    return `${cx+rr*Math.cos(a)},${cy+rr*Math.sin(a)}`;
  }).join(" ");
  return (
    <svg width={S} height={S}>
      {[0.33,0.66,1].map(f => (
        <polygon key={f} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={0.5}
          points={vals.map((_,i) => {
            const a=(i/vals.length)*Math.PI*2-Math.PI/2;
            return `${cx+rad*f*Math.cos(a)},${cy+rad*f*Math.sin(a)}`;
          }).join(" ")} />
      ))}
      <polygon points={pts} fill="rgba(10,132,255,0.2)" stroke="#0a84ff" strokeWidth={0.8}/>
    </svg>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useScreenerData() {
  return useQuery<ScreenerRow[]>({
    queryKey: ["screener-v2"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/screener`);
      if (!res.ok) throw new Error("screener fetch failed");
      return res.json();
    },
    staleTime: 3*60*1000, gcTime: 10*60*1000, retry: 2,
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Screener() {
  const [, setLocation] = useLocation();
  const navigate = setLocation;
  const { data: raw = [], isLoading, isFetching, error } = useScreenerData();

  const [view,        setView]        = useState<ViewMode>("table");
  const [weights,     setWeights]     = useState<Weights>(DEFAULT_WEIGHTS);
  const [sortKey,     setSortKey]     = useState("alpha");
  const [sortDir,     setSortDir]     = useState<"desc"|"asc">("desc");
  const [sector,      setSector]      = useState("");
  const [expression,  setExpression]  = useState("");
  const [exprErr,     setExprErr]     = useState(false);
  const [showWeights, setShowWeights] = useState(false);
  const [xAxis,       setXAxis]       = useState("fMomentum");
  const [yAxis,       setYAxis]       = useState("fValue");
  const [heatFactor,  setHeatFactor]  = useState("alpha");

  const factored = useMemo(() => computeFactors(raw, weights), [raw, weights]);

  const sectors = useMemo(() => {
    const s = new Set(factored.map(r => r.sector).filter(Boolean));
    return [...s].sort();
  }, [factored]);

  const filtered = useMemo(() => {
    let rows = factored;
    if (sector) rows = rows.filter(r => r.sector === sector);
    if (expression.trim()) {
      try {
        new Function(`"use strict"; return !!(${expression});`);
        rows = rows.filter(r => evalExpr(expression, r));
        setExprErr(false);
      } catch { setExprErr(true); }
    }
    return rows;
  }, [factored, sector, expression]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a,b) => {
      const va = (a as any)[sortKey] ?? 0, vb = (b as any)[sortKey] ?? 0;
      return sortDir === "desc" ? vb - va : va - vb;
    });
  }, [filtered, sortKey, sortDir]);

  const onSort = (k: string) => {
    if (sortKey === k) setSortDir(d => d==="desc"?"asc":"desc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  const totalW = weights.momentum + weights.value + weights.quality + weights.volatility + weights.options;

  return (
    <div style={{ display:"flex",flexDirection:"column",height:"100%",background:"#0a0a0a",color:"#fff",fontFamily:"Inter,system-ui,sans-serif",overflow:"hidden" }}>

      {/* ── Header ── */}
      <div style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 20px",borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0,flexWrap:"wrap" }}>
        <div>
          <div style={{ fontSize:15,fontWeight:700,letterSpacing:"-0.02em" }}>Factor Alpha Screener</div>
          <div style={{ fontSize:11,color:"rgba(255,255,255,0.38)",marginTop:1 }}>
            {isLoading ? "Loading universe…" :
              error ? "Error loading — retrying" :
              `${filtered.length.toLocaleString()} of ${factored.length.toLocaleString()} stocks · S&P 500 + NASDAQ 100 · ${isFetching?"Refreshing…":"Live"}`}
          </div>
        </div>
        <div style={{ flex:1 }} />

        {/* View toggle */}
        <div style={{ display:"flex",background:"rgba(255,255,255,0.05)",borderRadius:8,padding:2,gap:1 }}>
          {(["table","heatmap","scatter"] as ViewMode[]).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding:"5px 13px",borderRadius:6,border:"none",
              background:view===v?"rgba(10,132,255,0.25)":"transparent",
              color:view===v?"#0a84ff":"rgba(255,255,255,0.45)",
              fontSize:11,fontWeight:600,cursor:"pointer",
            }}>
              {v==="table"?"Factor Table":v==="heatmap"?"Sector Map":"Scatter Plot"}
            </button>
          ))}
        </div>

        <button onClick={() => setShowWeights(p=>!p)} style={{
          padding:"5px 13px",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:600,
          background:showWeights?"rgba(10,132,255,0.18)":"rgba(255,255,255,0.06)",
          border:showWeights?"1px solid rgba(10,132,255,0.35)":"1px solid transparent",
          color:showWeights?"#0a84ff":"rgba(255,255,255,0.6)",
        }}>⚖ Factor Weights</button>
      </div>

      {/* ── Weight panel ── */}
      <AnimatePresence>
        {showWeights && (
          <motion.div initial={{height:0,opacity:0}} animate={{height:"auto",opacity:1}} exit={{height:0,opacity:0}} transition={{duration:0.18}} style={{overflow:"hidden",flexShrink:0}}>
            <div style={{ padding:"10px 20px",borderBottom:"1px solid rgba(255,255,255,0.06)",display:"flex",gap:20,flexWrap:"wrap",alignItems:"flex-end",background:"rgba(10,132,255,0.03)" }}>
              <div style={{ fontSize:10,fontWeight:700,color:"#0a84ff",letterSpacing:"0.06em",textTransform:"uppercase",alignSelf:"center" }}>Alpha Composite Weights</div>
              {(Object.keys(weights) as (keyof Weights)[]).map(k => (
                <div key={k} style={{ display:"flex",flexDirection:"column",gap:3,minWidth:90 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",fontSize:10 }}>
                    <span style={{ color:"rgba(255,255,255,0.45)",textTransform:"capitalize" }}>{k==="options"?"Options Edge":k}</span>
                    <span style={{ color:"#fff",fontWeight:600,fontVariantNumeric:"tabular-nums" }}>{weights[k]}</span>
                  </div>
                  <input type="range" min={0} max={60} step={5} value={weights[k]}
                    onChange={e => setWeights(w => ({...w,[k]:+e.target.value}))}
                    style={{ width:"100%",accentColor:"#0a84ff" }} />
                </div>
              ))}
              <button onClick={() => setWeights(DEFAULT_WEIGHTS)} style={{ padding:"4px 10px",borderRadius:6,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.55)",fontSize:10,cursor:"pointer" }}>Reset</button>
              <span style={{ fontSize:10,color:totalW!==100?"#ff453a":"rgba(255,255,255,0.3)",alignSelf:"center" }}>Σ={totalW}%{totalW!==100?" (≠100%)":""}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Filter bar ── */}
      <div style={{ display:"flex",gap:8,padding:"8px 20px",borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0,flexWrap:"wrap",alignItems:"center" }}>
        <select value={sector} onChange={e => setSector(e.target.value)} style={{
          background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.09)",
          color:sector?"#fff":"rgba(255,255,255,0.4)",borderRadius:7,padding:"4px 8px",fontSize:11,cursor:"pointer",
        }}>
          <option value="">All Sectors</option>
          {sectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <input value={expression} onChange={e => { setExpression(e.target.value); setExprErr(false); }}
          placeholder="Expression: ivRank > 65 && fMomentum > 60 && relVol > 1.5"
          style={{
            flex:1,minWidth:220,background:"rgba(255,255,255,0.06)",
            border:`1px solid ${exprErr?"#ff453a":expression?"rgba(10,132,255,0.35)":"rgba(255,255,255,0.09)"}`,
            borderRadius:7,padding:"4px 10px",color:"#fff",fontSize:11,
            fontFamily:"ui-monospace,monospace",
          }} />
        {expression && <button onClick={() => { setExpression(""); setExprErr(false); }} style={{ padding:"4px 8px",borderRadius:6,background:"rgba(255,255,255,0.06)",border:"none",color:"rgba(255,255,255,0.5)",fontSize:11,cursor:"pointer" }}>✕</button>}

        <div style={{ display:"flex",gap:4,flexWrap:"wrap" }}>
          {ALPHA_STRATEGIES.map(s => (
            <button key={s.label} onClick={() => { setExpression(s.expr); setExprErr(false); }} title={s.desc} style={{
              padding:"3px 9px",borderRadius:5,fontSize:10,fontWeight:600,cursor:"pointer",
              background:expression===s.expr?"rgba(10,132,255,0.18)":"rgba(255,255,255,0.05)",
              border:expression===s.expr?"1px solid rgba(10,132,255,0.35)":"1px solid transparent",
              color:expression===s.expr?"#0a84ff":"rgba(255,255,255,0.5)",
            }}>{s.label}</button>
          ))}
        </div>
      </div>

      {/* ── Loading ── */}
      {isLoading && (
        <div style={{ flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12 }}>
          <div style={{ width:36,height:36,borderRadius:"50%",border:"2px solid rgba(10,132,255,0.2)",borderTopColor:"#0a84ff",animation:"spin 0.9s linear infinite" }} />
          <div style={{ color:"rgba(255,255,255,0.4)",fontSize:13 }}>Loading full S&P 500 + NASDAQ 100 universe…</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* ── Content ── */}
      {!isLoading && (
        <div style={{ flex:1,overflow:"hidden" }}>
          {view === "table"   && <TableView   rows={sorted}   sortKey={sortKey} sortDir={sortDir} onSort={onSort}       navigate={navigate} />}
          {view === "heatmap" && <HeatmapView rows={filtered} factor={heatFactor}                 setFactor={setHeatFactor} navigate={navigate} />}
          {view === "scatter" && <ScatterView rows={filtered} xAxis={xAxis} yAxis={yAxis}         setXAxis={setXAxis} setYAxis={setYAxis}   navigate={navigate} />}
        </div>
      )}
    </div>
  );
}

// ─── Table View ───────────────────────────────────────────────────────────────

function TableView({ rows, sortKey, sortDir, onSort, navigate }: {
  rows: FactoredRow[]; sortKey: string; sortDir:"asc"|"desc"; onSort:(k:string)=>void; navigate:(p:string)=>void;
}) {
  const TH = ({ k, label, r }: { k:string; label:string; r?:boolean }) => (
    <th onClick={() => onSort(k)} style={{
      padding:"7px 10px",fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",
      color:sortKey===k?"#0a84ff":"rgba(255,255,255,0.35)",textAlign:r?"right":"left",
      cursor:"pointer",userSelect:"none",whiteSpace:"nowrap",
      position:"sticky",top:0,background:"#111",zIndex:2,
      borderBottom:"1px solid rgba(255,255,255,0.07)",
    }}>
      {label}{sortKey===k?(sortDir==="desc"?" ↓":" ↑"):""}
    </th>
  );

  return (
    <div style={{ height:"100%",overflow:"auto" }}>
      <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12 }}>
        <thead>
          <tr>
            <TH k="symbol"       label="Symbol" />
            <TH k="price"        label="Price"    r />
            <TH k="changePercent"label="1D %"     r />
            <TH k="relVol"       label="Rel Vol"  r />
            <TH k="marketCap"    label="Mkt Cap"  r />
            <TH k="ivRank"       label="IV Rank"  r />
            <TH k="beta"         label="Beta"     r />
            <TH k="pe"           label="P/E"      r />
            <TH k="shortRatio"   label="Short Ratio" r />
            <TH k="fMomentum"   label="Momentum" />
            <TH k="fValue"      label="Value" />
            <TH k="fQuality"    label="Quality" />
            <TH k="fVolatility" label="Volatility" />
            <TH k="fOptions"    label="Options" />
            <TH k="alpha"       label="α Score"  r />
            <TH k="setupType"   label="Setup" />
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 300).map((r, i) => {
            const up = r.changePercent >= 0;
            return (
              <tr key={r.symbol}
                onClick={() => navigate(`/scanner?symbol=${r.symbol}`)}
                style={{ borderBottom:"1px solid rgba(255,255,255,0.04)",background:i%2?"rgba(255,255,255,0.015)":"transparent",cursor:"pointer" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(10,132,255,0.06)")}
                onMouseLeave={e => (e.currentTarget.style.background = i%2?"rgba(255,255,255,0.015)":"transparent")}
              >
                <td style={{ padding:"6px 10px",whiteSpace:"nowrap" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                    <RadarMini r={r} />
                    <div>
                      <div style={{ fontWeight:700,fontSize:13 }}>{r.symbol}</div>
                      <div style={{ fontSize:10,color:"rgba(255,255,255,0.3)",maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{r.name}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding:"6px 10px",textAlign:"right",fontVariantNumeric:"tabular-nums",fontWeight:600 }}>${r.price.toFixed(2)}</td>
                <td style={{ padding:"6px 10px",textAlign:"right",fontVariantNumeric:"tabular-nums",fontWeight:600,color:up?"#30d158":"#ff453a" }}>{up?"+":""}{r.changePercent.toFixed(2)}%</td>
                <td style={{ padding:"6px 10px",textAlign:"right",fontVariantNumeric:"tabular-nums",color:r.relVol>3?"#ff9f0a":r.relVol>2?"#ffd60a":"rgba(255,255,255,0.65)" }}>{r.relVol.toFixed(2)}×</td>
                <td style={{ padding:"6px 10px",textAlign:"right",fontVariantNumeric:"tabular-nums",color:"rgba(255,255,255,0.55)" }}>{fmtBig(r.marketCap)}</td>
                <td style={{ padding:"6px 10px",textAlign:"right",fontVariantNumeric:"tabular-nums",color:r.ivRank>70?"#ff9f0a":r.ivRank>50?"#ffd60a":"rgba(255,255,255,0.55)" }}>{r.ivRank.toFixed(0)}</td>
                <td style={{ padding:"6px 10px",textAlign:"right",fontVariantNumeric:"tabular-nums",color:"rgba(255,255,255,0.55)" }}>{r.beta.toFixed(2)}</td>
                <td style={{ padding:"6px 10px",textAlign:"right",fontVariantNumeric:"tabular-nums",color:"rgba(255,255,255,0.55)" }}>{r.pe>0?r.pe.toFixed(1):"—"}</td>
                <td style={{ padding:"6px 10px",textAlign:"right",fontVariantNumeric:"tabular-nums",color:r.shortRatio>7?"#ff453a":r.shortRatio>4?"#ff9f0a":"rgba(255,255,255,0.55)" }}>{r.shortRatio>0?r.shortRatio.toFixed(1)+"d":"—"}</td>
                <td style={{ padding:"6px 10px" }}><FactorBar value={r.fMomentum} color="#0a84ff" /></td>
                <td style={{ padding:"6px 10px" }}><FactorBar value={r.fValue}    color="#30d158" /></td>
                <td style={{ padding:"6px 10px" }}><FactorBar value={r.fQuality}  color="#bf5af2" /></td>
                <td style={{ padding:"6px 10px" }}><FactorBar value={r.fVolatility} color="#ff9f0a" /></td>
                <td style={{ padding:"6px 10px" }}><FactorBar value={r.fOptions}  color="#ff375f" /></td>
                <td style={{ padding:"6px 10px",textAlign:"right" }}><AlphaBadge v={r.alpha} /></td>
                <td style={{ padding:"6px 10px" }}>
                  <span style={{
                    padding:"2px 6px",borderRadius:4,fontSize:10,fontWeight:600,
                    background:r.recommendedOutlook==="bullish"?"rgba(48,209,88,0.15)":r.recommendedOutlook==="bearish"?"rgba(255,69,58,0.15)":"rgba(255,255,255,0.06)",
                    color:r.recommendedOutlook==="bullish"?"#30d158":r.recommendedOutlook==="bearish"?"#ff453a":"rgba(255,255,255,0.45)",
                  }}>{r.setupType}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 300 && (
        <div style={{ padding:"12px 20px",color:"rgba(255,255,255,0.3)",fontSize:11,textAlign:"center" }}>
          Showing top 300 of {rows.length.toLocaleString()} matches. Refine the expression filter to narrow results.
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
    <div style={{ height:"100%",display:"flex",flexDirection:"column" }}>
      <div style={{ padding:"8px 20px",display:"flex",gap:6,flexShrink:0,flexWrap:"wrap",borderBottom:"1px solid rgba(255,255,255,0.06)",alignItems:"center" }}>
        <span style={{ fontSize:10,color:"rgba(255,255,255,0.35)",marginRight:4 }}>Color by:</span>
        {FACTOR_AXES.map(a => (
          <button key={a.key} onClick={() => setFactor(a.key)} style={{
            padding:"3px 9px",borderRadius:5,fontSize:10,fontWeight:600,cursor:"pointer",
            background:factor===a.key?"rgba(10,132,255,0.18)":"rgba(255,255,255,0.05)",
            border:factor===a.key?"1px solid rgba(10,132,255,0.35)":"1px solid transparent",
            color:factor===a.key?"#0a84ff":"rgba(255,255,255,0.45)",
          }}>{a.label}</button>
        ))}
      </div>
      <div style={{ flex:1,overflow:"auto",padding:"14px 20px" }}>
        {bySector.map(([sec, stocks]) => (
          <div key={sec} style={{ marginBottom:18 }}>
            <div style={{ fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.35)",letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:7 }}>
              {sec} <span style={{ fontWeight:400,opacity:0.6 }}>({stocks.length})</span>
            </div>
            <div style={{ display:"flex",flexWrap:"wrap",gap:3 }}>
              {stocks.sort((a,b) => Math.abs(getV(b))-Math.abs(getV(a))).slice(0,60).map(r => {
                const v = getV(r);
                const area = Math.max(36, Math.min(80, 36 + (r.marketCap/6e11)*44));
                return (
                  <div key={r.symbol} onClick={() => navigate(`/scanner?symbol=${r.symbol}`)}
                    title={`${r.name}\n${FACTOR_AXES.find(a=>a.key===factor)?.label}: ${typeof v==="number"?v.toFixed(1):v}`}
                    style={{
                      width:area,height:area,background:heatColor(v),borderRadius:5,
                      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                      cursor:"pointer",border:"1px solid rgba(255,255,255,0.05)",transition:"transform 0.1s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform="scale(1.1)"; e.currentTarget.style.zIndex="5"; e.currentTarget.style.borderColor="rgba(10,132,255,0.5)"; }}
                    onMouseLeave={e => { e.currentTarget.style.transform="scale(1)"; e.currentTarget.style.zIndex="1"; e.currentTarget.style.borderColor="rgba(255,255,255,0.05)"; }}>
                    <span style={{ fontSize:Math.max(8,Math.min(11,area/7)),fontWeight:700 }}>{r.symbol}</span>
                    <span style={{ fontSize:9,opacity:0.65,fontVariantNumeric:"tabular-nums" }}>
                      {typeof v==="number"?(Math.abs(v)<100?v.toFixed(1):v.toFixed(0)):v}
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
    <div style={{ height:"100%",display:"flex",flexDirection:"column" }}>
      <div style={{ padding:"8px 20px",display:"flex",gap:14,alignItems:"center",flexShrink:0,borderBottom:"1px solid rgba(255,255,255,0.06)",flexWrap:"wrap" }}>
        <div style={{ display:"flex",gap:6,alignItems:"center" }}>
          <span style={{ fontSize:10,color:"rgba(255,255,255,0.35)" }}>X:</span>
          <select value={xAxis} onChange={e=>setXAxis(e.target.value)} style={{ background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.09)",color:"#fff",borderRadius:6,padding:"3px 7px",fontSize:10,cursor:"pointer" }}>
            {FACTOR_AXES.map(a=><option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </div>
        <div style={{ display:"flex",gap:6,alignItems:"center" }}>
          <span style={{ fontSize:10,color:"rgba(255,255,255,0.35)" }}>Y:</span>
          <select value={yAxis} onChange={e=>setYAxis(e.target.value)} style={{ background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.09)",color:"#fff",borderRadius:6,padding:"3px 7px",fontSize:10,cursor:"pointer" }}>
            {FACTOR_AXES.map(a=><option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </div>
        <div style={{ marginLeft:"auto",display:"flex",gap:14,fontSize:10,color:"rgba(255,255,255,0.35)" }}>
          <span><span style={{ color:"#30d158" }}>●</span> Bullish</span>
          <span><span style={{ color:"#ff453a" }}>●</span> Bearish</span>
          <span><span style={{ color:"#0a84ff" }}>●</span> Neutral</span>
          <span>Size = market cap</span>
          <span style={{ color:"rgba(255,255,255,0.2)" }}>{rows.length} stocks</span>
        </div>
      </div>
      <div style={{ flex:1,overflow:"hidden",padding:"6px 10px",position:"relative" }}>
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
            position:"absolute",left:tip.x+14,top:tip.y-8,
            background:"#1c1c1e",border:"1px solid rgba(255,255,255,0.12)",
            borderRadius:10,padding:"10px 14px",minWidth:170,pointerEvents:"none",zIndex:10,
          }}>
            <div style={{ fontWeight:700,fontSize:13 }}>{tip.row.symbol}</div>
            <div style={{ fontSize:10,color:"rgba(255,255,255,0.45)",marginBottom:7 }}>{tip.row.name}</div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 10px",fontSize:10 }}>
              <span style={{ color:"rgba(255,255,255,0.4)" }}>{xLbl}</span><span style={{ fontVariantNumeric:"tabular-nums" }}>{gv(tip.row,xAxis).toFixed(1)}</span>
              <span style={{ color:"rgba(255,255,255,0.4)" }}>{yLbl}</span><span style={{ fontVariantNumeric:"tabular-nums" }}>{gv(tip.row,yAxis).toFixed(1)}</span>
              <span style={{ color:"rgba(255,255,255,0.4)" }}>α Score</span><span style={{ fontVariantNumeric:"tabular-nums",color:"#0a84ff",fontWeight:700 }}>{tip.row.alpha}</span>
              <span style={{ color:"rgba(255,255,255,0.4)" }}>Price</span><span style={{ fontVariantNumeric:"tabular-nums" }}>${tip.row.price.toFixed(2)}</span>
              <span style={{ color:"rgba(255,255,255,0.4)" }}>IV Rank</span><span style={{ fontVariantNumeric:"tabular-nums" }}>{tip.row.ivRank.toFixed(0)}</span>
              <span style={{ color:"rgba(255,255,255,0.4)" }}>Rel Vol</span><span style={{ fontVariantNumeric:"tabular-nums" }}>{tip.row.relVol.toFixed(2)}×</span>
            </div>
            <div style={{ marginTop:6,fontSize:9,color:"rgba(10,132,255,0.7)" }}>Click → open in Analysis</div>
          </div>
        )}
      </div>
    </div>
  );
}
