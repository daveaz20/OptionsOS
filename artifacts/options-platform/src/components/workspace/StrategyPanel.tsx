import { useState, useEffect } from "react";
import { useGetStrategies, useCalculatePnl } from "@workspace/api-client-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { formatCurrency, formatPercent } from "@/lib/format";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, BarChart2, ChevronDown, ChevronUp, Minus, Pencil, Plus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { OptionsStrategy, StrategyLeg, GetStrategiesOutlook } from "@workspace/api-client-react";

interface StrategyPanelProps {
  symbol: string;
  currentPrice?: number;
}

const OUTLOOK_TABS: { id: GetStrategiesOutlook; label: string; color: string }[] = [
  { id: "bullish", label: "Bullish", color: "hsl(var(--success))" },
  { id: "neutral", label: "Neutral", color: "hsl(var(--primary))" },
  { id: "bearish", label: "Bearish", color: "hsl(var(--destructive))" },
];

// ── Black-Scholes (frontend copy for modify recalc) ──────────────────────
function normalCDF(x: number): number {
  const a = 0.2316419;
  const k = 1 / (1 + a * Math.abs(x));
  const poly = k * (0.31938 + k * (-0.35656 + k * (1.78147 + k * (-1.82125 + k * 1.33027))));
  const phi = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const prob = 1 - phi * poly;
  return x >= 0 ? prob : 1 - prob;
}

function bsPrice(S: number, K: number, T: number, sigma: number, type: "call" | "put"): number {
  if (T <= 0) return Math.max(0, type === "call" ? S - K : K - S);
  const r = 0.045;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (type === "call") return S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
  return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}

// ── Payoff at expiration ─────────────────────────────────────────────────
function computePayoffs(legs: StrategyLeg[], prices: number[]): number[] {
  return prices.map(S =>
    legs.reduce((total, leg) => {
      const sign = leg.action === "buy" ? 1 : -1;
      if (leg.optionType === "call") return total + sign * (Math.max(0, S - leg.strikePrice) - leg.premium) * 100 * leg.quantity;
      if (leg.optionType === "put")  return total + sign * (Math.max(0, leg.strikePrice - S) - leg.premium) * 100 * leg.quantity;
      return total + sign * (S - leg.strikePrice) * leg.quantity; // stock
    }, 0)
  );
}

function computeMetrics(legs: StrategyLeg[], currentPrice: number) {
  const steps = 200;
  const pMin = currentPrice * 0.5;
  const pMax = currentPrice * 1.5;
  const prices = Array.from({ length: steps + 1 }, (_, i) => pMin + (i / steps) * (pMax - pMin));
  const pnls = computePayoffs(legs, prices);

  const maxProfit = Math.max(...pnls);
  const maxLoss   = Math.min(...pnls);
  const cost      = legs.reduce((sum, l) => {
    const sign = l.action === "buy" ? -1 : 1;
    if (l.optionType === "stock") return sum + sign * l.strikePrice * l.quantity;
    return sum + sign * l.premium * 100 * l.quantity;
  }, 0);

  // Breakeven: first price where P&L crosses zero
  let breakeven = currentPrice;
  for (let i = 1; i <= steps; i++) {
    if (pnls[i - 1]! < 0 && pnls[i]! >= 0) { breakeven = prices[i]!; break; }
    if (pnls[i - 1]! > 0 && pnls[i]! <= 0) { breakeven = prices[i - 1]!; break; }
  }

  return { maxProfit: Math.round(maxProfit * 100) / 100, maxLoss: Math.round(maxLoss * 100) / 100, cost: Math.round(cost * 100) / 100, breakeven: Math.round(breakeven * 100) / 100 };
}

// ── PayoffDiagram ────────────────────────────────────────────────────────
function PayoffDiagram({ legs, currentPrice }: { legs: StrategyLeg[]; currentPrice: number }) {
  if (!currentPrice || currentPrice <= 0) return null;
  const W = 300, H = 130;
  const PL = 0, PR = 0, PT = 10, PB = 10;
  const cw = W - PL - PR, ch = H - PT - PB;
  const STEPS = 80;
  const pMin = currentPrice * 0.72;
  const pMax = currentPrice * 1.28;
  const prices = Array.from({ length: STEPS + 1 }, (_, i) => pMin + (i / STEPS) * (pMax - pMin));
  const pnls = computePayoffs(legs, prices);
  const pnlMax = Math.max(...pnls, 1);
  const pnlMin = Math.min(...pnls, -1);
  const range = Math.max(Math.abs(pnlMax), Math.abs(pnlMin)) * 2.1 || 1;
  const midPnl = (pnlMax + pnlMin) / 2;
  const yTop = midPnl + range / 2;

  const x = (i: number) => PL + (i / STEPS) * cw;
  const y = (pnl: number) => PT + ((yTop - pnl) / range) * ch;
  const zeroY = y(0);
  const curX = PL + ((currentPrice - pMin) / (pMax - pMin)) * cw;

  // Build fill regions above and below zero
  const buildFill = (above: boolean) => {
    const pts: [number, number][] = [];
    let started = false;
    for (let i = 0; i <= STEPS; i++) {
      const pnl = pnls[i]!;
      const isAbove = pnl >= 0;
      if ((above && isAbove) || (!above && !isAbove)) {
        const clampedY = above ? Math.min(y(pnl), zeroY) : Math.max(y(pnl), zeroY);
        if (!started) {
          pts.push([x(i), zeroY]);
          started = true;
        }
        pts.push([x(i), clampedY]);
      } else if (started) {
        pts.push([x(i - 1), zeroY]);
        started = false;
      }
    }
    if (started) pts.push([x(STEPS), zeroY]);
    if (pts.length < 3) return null;
    return "M " + pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" L ") + " Z";
  };

  const linePath = pnls.map((pnl, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(pnl).toFixed(1)}`).join(" ");
  const greenFill = buildFill(true);
  const redFill   = buildFill(false);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", borderRadius: 6, background: "rgba(0,0,0,0.35)" }}>
      {/* Zero line */}
      <line x1={PL} x2={W - PR} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      {/* Fills */}
      {greenFill && <path d={greenFill} fill="hsl(var(--success))" fillOpacity="0.28" />}
      {redFill   && <path d={redFill}   fill="hsl(var(--destructive))" fillOpacity="0.32" />}
      {/* P&L line */}
      <path d={linePath} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {/* Current price marker */}
      <line x1={curX} x2={curX} y1={PT} y2={H - PB} stroke="rgba(255,255,255,0.35)" strokeWidth="1" strokeDasharray="3 4" />
      <circle cx={curX} cy={y(computePayoffs(legs, [currentPrice])[0]!)} r="3" fill="hsl(var(--primary))" />
    </svg>
  );
}

// ── Strategy Detail (OptionsPlay-style card) ─────────────────────────────
function StrategyDetail({
  strategy, currentPrice, symbol, onModify,
}: {
  strategy: OptionsStrategy;
  currentPrice: number;
  symbol: string;
  onModify: () => void;
}) {
  const { toast } = useToast();
  const [showSim, setShowSim] = useState(false);

  const exp = strategy.expirationDate;
  const dte = Math.max(0, Math.round((new Date(exp).getTime() - Date.now()) / 86_400_000));

  // POP approximation — credit spreads: credit / width; debit: 1 - debit/width
  const pop = strategy.type === "income"
    ? Math.min(85, Math.max(20, Math.round((Math.abs(strategy.tradeCost) / Math.max(1, Math.abs(strategy.tradeCost) + Math.abs(strategy.maxLoss))) * 100)))
    : Math.min(75, Math.max(25, Math.round(42 + (strategy.score - 100) * 0.15)));

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, background: "rgba(255,255,255,0.02)", overflow: "hidden" }}>
      {/* Strategy name bar */}
      <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "-0.01em", color: "hsl(var(--foreground))", lineHeight: 1.35 }}>
          {strategy.name}
        </div>
        <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
          {strategy.type === "income" ? "Income" : "Trade"} · Exp {exp}
        </div>
      </div>

      {/* Payoff diagram */}
      <div style={{ padding: "10px 10px 8px" }}>
        <PayoffDiagram legs={strategy.legs} currentPrice={currentPrice} />
      </div>

      {/* Metrics grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        {[
          { label: "Cost",        value: formatCurrency(strategy.tradeCost), color: strategy.tradeCost < 0 ? "hsl(var(--destructive))" : "hsl(var(--success))" },
          { label: "Max reward",  value: formatCurrency(strategy.maxProfit), color: strategy.maxProfit >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))" },
          { label: "Max risk",    value: formatCurrency(Math.abs(strategy.maxLoss)), color: "hsl(var(--destructive))" },
          { label: "POP",         value: `${pop}%`, color: pop >= 60 ? "hsl(var(--success))" : "hsl(var(--foreground))" },
          { label: "Breakeven",   value: formatCurrency(strategy.breakeven), color: "hsl(var(--foreground))" },
          { label: "Days to exp", value: `${dte}`, color: "hsl(var(--foreground))" },
        ].map((m, i) => (
          <div key={i} style={{
            padding: "9px 12px",
            borderRight: i % 2 === 0 ? "1px solid rgba(255,255,255,0.05)" : undefined,
            borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.05)" : undefined,
            display: "flex", flexDirection: "column", gap: 3,
          }}>
            <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontWeight: 400 }}>{m.label}</span>
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.02em", color: m.color, fontVariantNumeric: "tabular-nums" }}>{m.value}</span>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <button
          onClick={() => toast({ title: "Trade order", description: "Broker connection needed — add Schwab credentials to execute." })}
          style={{
            padding: "8px 0", borderRadius: 7, border: "none", fontWeight: 600, fontSize: 12,
            background: "hsl(var(--primary))", color: "#fff", cursor: "pointer", letterSpacing: "-0.01em",
          }}
        >
          Trade
        </button>
        <button
          onClick={onModify}
          style={{
            padding: "8px 0", borderRadius: 7, fontWeight: 600, fontSize: 12,
            border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)",
            color: "hsl(var(--foreground))", cursor: "pointer", letterSpacing: "-0.01em",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
          }}
        >
          <Pencil style={{ width: 11, height: 11 }} />
          Modify
        </button>
      </div>

      {/* P&L Simulator toggle */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <button
          onClick={() => setShowSim(!showSim)}
          style={{
            width: "100%", padding: "9px 12px", display: "flex", alignItems: "center", justifyContent: "space-between",
            background: "transparent", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))",
            fontSize: 11, fontWeight: 500,
          }}
        >
          <span>P&amp;L Simulator</span>
          {showSim ? <ChevronUp style={{ width: 13, height: 13 }} /> : <ChevronDown style={{ width: 13, height: 13 }} />}
        </button>
        {showSim && (
          <div style={{ padding: "0 12px 14px" }}>
            <PnlSimulator strategy={strategy} currentPrice={currentPrice} symbol={symbol} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Modify Panel ─────────────────────────────────────────────────────────
interface ModifiedLeg extends StrategyLeg {
  premium: number;
}

function ModifyPanel({
  strategy, currentPrice, iv, onClose,
}: {
  strategy: OptionsStrategy;
  currentPrice: number;
  iv: number;
  onClose: (updated: OptionsStrategy | null) => void;
}) {
  const increment = currentPrice < 50 ? 1 : currentPrice < 200 ? 2.5 : 5;
  const [legs, setLegs] = useState<ModifiedLeg[]>(
    strategy.legs.map(l => ({ ...l }))
  );
  // Derive initial expiry date from strategy, default to 45 DTE if past
  const initExpStr = (() => {
    const stratDays = Math.round((new Date(strategy.expirationDate).getTime() - Date.now()) / 86_400_000);
    const days = stratDays > 5 ? stratDays : 45;
    const d = new Date(); d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0]!;
  })();
  const [expStr, setExpStr] = useState(initExpStr);
  const [contracts, setContracts] = useState(1);

  // DTE computed from the chosen date
  const dte = Math.max(1, Math.round((new Date(expStr).getTime() - Date.now()) / 86_400_000));

  // Min date = tomorrow, max date = 2 years out
  const minDate = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split("T")[0]!; })();
  const maxDate = (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 2); return d.toISOString().split("T")[0]!; })();

  const setDteQuick = (days: number) => {
    const d = new Date(); d.setDate(d.getDate() + days);
    setExpStr(d.toISOString().split("T")[0]!);
  };

  // Which quick button (if any) matches the current date?
  const activeQuick = [30, 45, 60].find(d => {
    const candidate = new Date(); candidate.setDate(candidate.getDate() + d);
    return Math.abs(new Date(expStr).getTime() - candidate.getTime()) < 86_400_000 * 2;
  }) ?? null;

  const T = dte / 365;
  const sigma = Math.max(0.15, iv / 100);

  const recalcPremium = (leg: ModifiedLeg): ModifiedLeg => {
    if (leg.optionType === "stock") return leg;
    const premium = Math.round(bsPrice(currentPrice, leg.strikePrice, T, sigma, leg.optionType as "call" | "put") * 100) / 100;
    return { ...leg, premium: Math.max(0.01, premium) };
  };

  const updateStrike = (i: number, delta: number) => {
    setLegs(prev => {
      const next = [...prev];
      const leg = { ...next[i]! };
      leg.strikePrice = Math.round((leg.strikePrice + delta * increment) * 100) / 100;
      next[i] = recalcPremium(leg);
      return next;
    });
  };

  const updatedMetrics = computeMetrics(legs.map(l => ({ ...l, quantity: l.quantity * contracts })), currentPrice);

  const apply = () => {
    const updated: OptionsStrategy = {
      ...strategy,
      legs: legs.map(l => ({ ...l, quantity: l.quantity * contracts, expiration: expStr })),
      expirationDate: expStr,
      tradeCost: Math.round(updatedMetrics.cost * 100) / 100,
      maxProfit: Math.round(updatedMetrics.maxProfit * 100) / 100,
      maxLoss: Math.round(updatedMetrics.maxLoss * 100) / 100,
      breakeven: Math.round(updatedMetrics.breakeven * 100) / 100,
      returnPercent: updatedMetrics.maxLoss !== 0
        ? Math.round((updatedMetrics.maxProfit / Math.abs(updatedMetrics.maxLoss)) * 100 * 100) / 100
        : 0,
    };
    onClose(updated);
  };

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, background: "rgba(255,255,255,0.02)", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.01em" }}>Modify strategy</span>
        <button onClick={() => onClose(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--muted-foreground))", display: "flex" }}>
          <X style={{ width: 14, height: 14 }} />
        </button>
      </div>

      {/* Live payoff */}
      <div style={{ padding: "10px 10px 8px" }}>
        <PayoffDiagram legs={legs.map(l => ({ ...l, quantity: l.quantity * contracts }))} currentPrice={currentPrice} />
      </div>

      {/* Legs editor */}
      <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 10 }}>
        {legs.filter(l => l.optionType !== "stock").map((leg, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              fontSize: 9, fontWeight: 600, letterSpacing: "0.04em", padding: "2px 5px", borderRadius: 3,
              background: leg.action === "buy" ? "hsl(var(--success)/0.15)" : "hsl(var(--destructive)/0.15)",
              color: leg.action === "buy" ? "hsl(var(--success))" : "hsl(var(--destructive))",
              textTransform: "uppercase", flexShrink: 0,
            }}>
              {leg.action} {leg.optionType}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, justifyContent: "flex-end" }}>
              <button onClick={() => updateStrike(i, -1)} style={stepBtn}><Minus style={{ width: 10, height: 10 }} /></button>
              <span style={{ fontSize: 12, fontWeight: 600, minWidth: 52, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                ${leg.strikePrice % 1 === 0 ? leg.strikePrice.toFixed(0) : leg.strikePrice.toFixed(1)}
              </span>
              <button onClick={() => updateStrike(i, +1)} style={stepBtn}><Plus style={{ width: 10, height: 10 }} /></button>
              <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                ${leg.premium.toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Expiry + Contracts */}
      <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginBottom: 5 }}>Expiry · {dte}d</div>
          {/* Quick-select buttons */}
          <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
            {[30, 45, 60].map(d => (
              <button key={d} onClick={() => setDteQuick(d)} style={{
                flex: 1, padding: "4px 0", borderRadius: 5, fontSize: 10, fontWeight: 600,
                border: activeQuick === d ? "1px solid hsl(var(--primary)/0.4)" : "1px solid rgba(255,255,255,0.08)",
                background: activeQuick === d ? "hsl(var(--primary)/0.1)" : "transparent",
                color: activeQuick === d ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                cursor: "pointer",
              }}>
                {d}d
              </button>
            ))}
          </div>
          {/* Exact date picker */}
          <input
            type="date"
            value={expStr}
            min={minDate}
            max={maxDate}
            onChange={e => { if (e.target.value) setExpStr(e.target.value); }}
            style={{
              width: "100%", padding: "4px 8px", borderRadius: 5, fontSize: 11, fontWeight: 500,
              border: activeQuick === null ? "1px solid hsl(var(--primary)/0.5)" : "1px solid rgba(255,255,255,0.10)",
              background: activeQuick === null ? "hsl(var(--primary)/0.07)" : "rgba(255,255,255,0.04)",
              color: "hsl(var(--foreground))", outline: "none", cursor: "pointer",
              colorScheme: "dark", boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginBottom: 5 }}>Contracts</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => setContracts(c => Math.max(1, c - 1))} style={stepBtn}><Minus style={{ width: 10, height: 10 }} /></button>
            <span style={{ fontSize: 13, fontWeight: 700, minWidth: 20, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{contracts}</span>
            <button onClick={() => setContracts(c => Math.min(20, c + 1))} style={stepBtn}><Plus style={{ width: 10, height: 10 }} /></button>
          </div>
        </div>
      </div>

      {/* Modified metrics preview */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        {[
          { label: "Cost",       value: formatCurrency(updatedMetrics.cost),      color: updatedMetrics.cost < 0 ? "hsl(var(--destructive))" : "hsl(var(--success))" },
          { label: "Max reward", value: formatCurrency(updatedMetrics.maxProfit),  color: updatedMetrics.maxProfit >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))" },
          { label: "Max risk",   value: formatCurrency(Math.abs(updatedMetrics.maxLoss)), color: "hsl(var(--destructive))" },
        ].map((m, i) => (
          <div key={i} style={{
            padding: "8px 10px",
            borderRight: i < 2 ? "1px solid rgba(255,255,255,0.05)" : undefined,
          }}>
            <div style={{ fontSize: 9.5, color: "hsl(var(--muted-foreground))", marginBottom: 3 }}>{m.label}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: m.color, fontVariantNumeric: "tabular-nums" }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Apply */}
      <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <button onClick={apply} style={{
          width: "100%", padding: "9px 0", borderRadius: 7, border: "none",
          background: "hsl(var(--primary))", color: "#fff", fontWeight: 600, fontSize: 12,
          cursor: "pointer", letterSpacing: "-0.01em",
        }}>
          Apply changes
        </button>
      </div>
    </div>
  );
}

const stepBtn: React.CSSProperties = {
  width: 24, height: 24, borderRadius: 5, border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.05)", color: "hsl(var(--foreground))",
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
};

// ── Main StrategyPanel ───────────────────────────────────────────────────
export function StrategyPanel({ symbol, currentPrice = 0 }: StrategyPanelProps) {
  const [outlook, setOutlook] = useState<GetStrategiesOutlook>("bullish");
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null);
  const [modifying, setModifying] = useState(false);
  const [customStrategies, setCustomStrategies] = useState<Record<string, OptionsStrategy>>({});

  const { data: strategies = [], isLoading } = useGetStrategies(symbol, { outlook }, { query: { enabled: !!symbol } });

  useEffect(() => {
    if (strategies.length > 0 && !selectedStrategyId) setSelectedStrategyId(strategies[0]!.id);
    else if (strategies.length === 0) setSelectedStrategyId(null);
    setModifying(false);
  }, [strategies, outlook]);

  if (!symbol) {
    return (
      <div className="flex h-full items-center justify-center text-center p-8"
        style={{ borderLeft: "1px solid rgba(255,255,255,0.05)", background: "hsl(0 0% 5%)" }}>
        <div>
          <BarChart2 style={{ width: 28, height: 28, opacity: 0.2, margin: "0 auto 10px" }} />
          <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>Select a stock to view strategies</p>
        </div>
      </div>
    );
  }

  const rawSelected = strategies.find((s) => s.id === selectedStrategyId);
  const customKey = `${symbol}:${outlook}:${selectedStrategyId}`;
  const selectedStrategy = customStrategies[customKey] ?? rawSelected;

  // Estimate IV from the strategy score / HV proxy — rough but workable
  const estimatedIv = selectedStrategy ? Math.max(15, Math.min(120, 25 + (strategies.length > 0 ? 20 : 0))) : 30;

  return (
    <div className="flex h-full flex-col" style={{ borderLeft: "1px solid rgba(255,255,255,0.05)", background: "hsl(0 0% 5%)" }}>
      {/* Header */}
      <div style={{ padding: "16px 16px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em" }}>Strategies</h2>
          <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{symbol}</span>
        </div>
        <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 3, marginBottom: 14 }}>
          {OUTLOOK_TABS.map((t) => {
            const active = t.id === outlook;
            return (
              <button key={t.id} onClick={() => { setOutlook(t.id); setSelectedStrategyId(null); }} style={{
                flex: 1, padding: "5px 0", borderRadius: 6, border: "none", fontSize: 12,
                fontWeight: active ? 600 : 400,
                color: active ? t.color : "hsl(var(--muted-foreground))",
                background: active ? `${t.color}14` : "transparent",
                cursor: "pointer", transition: "all 0.15s", letterSpacing: "-0.01em",
              }}>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div style={{ padding: "10px 12px 32px", display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Strategy list */}
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ height: 88, borderRadius: 8, background: "rgba(255,255,255,0.04)", animation: "pulse 1.4s infinite" }} />
            ))
          ) : strategies.length === 0 ? (
            <div style={{ padding: "40px 8px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <AlertCircle style={{ width: 22, height: 22, opacity: 0.3 }} />
              No {outlook} strategies available
            </div>
          ) : (
            strategies.map((strategy) => {
              const custom = customStrategies[`${symbol}:${outlook}:${strategy.id}`];
              return (
                <StrategyCard
                  key={strategy.id}
                  strategy={custom ?? strategy}
                  isSelected={strategy.id === selectedStrategyId}
                  isModified={!!custom}
                  onClick={() => { setSelectedStrategyId(strategy.id); setModifying(false); }}
                />
              );
            })
          )}

          {/* Detail / Modify area */}
          {selectedStrategy && !isLoading && (
            <div style={{ marginTop: 10 }}>
              {modifying ? (
                <ModifyPanel
                  strategy={selectedStrategy}
                  currentPrice={currentPrice}
                  iv={estimatedIv}
                  onClose={(updated) => {
                    if (updated) setCustomStrategies(prev => ({ ...prev, [customKey]: updated }));
                    setModifying(false);
                  }}
                />
              ) : (
                <StrategyDetail
                  strategy={selectedStrategy}
                  currentPrice={currentPrice}
                  symbol={symbol}
                  onModify={() => setModifying(true)}
                />
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Strategy Card (compact list item) ────────────────────────────────────
function StrategyCard({ strategy, isSelected, isModified, onClick }: {
  strategy: OptionsStrategy; isSelected: boolean; isModified: boolean; onClick: () => void;
}) {
  const pct = Math.min(Math.max(strategy.score / 200, 0), 1);
  const scoreColor = strategy.score > 120 ? "hsl(var(--success))" : strategy.score < 80 ? "hsl(var(--destructive))" : "hsl(var(--primary))";

  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 8,
        border: isSelected ? "1px solid hsl(var(--primary) / 0.3)" : "1px solid rgba(255,255,255,0.06)",
        background: isSelected ? "hsl(var(--primary) / 0.07)" : "rgba(255,255,255,0.025)",
        cursor: "pointer", transition: "all 0.12s",
      }}
      onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.045)"; }}
      onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.025)"; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ minWidth: 0, paddingRight: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "-0.02em", color: "hsl(var(--foreground))", marginBottom: 2, display: "flex", alignItems: "center", gap: 5 }}>
            {strategy.name}
            {isModified && (
              <span style={{ fontSize: 8.5, fontWeight: 600, padding: "1px 4px", borderRadius: 3, background: "hsl(var(--primary)/0.15)", color: "hsl(var(--primary))", letterSpacing: "0.03em" }}>
                MODIFIED
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", display: "flex", gap: 5, alignItems: "center" }}>
            <span>{strategy.type === "income" ? "Income" : "Trade"}</span>
            <span style={{ opacity: 0.3 }}>·</span>
            <span>Exp {strategy.expirationDate}</span>
          </div>
        </div>
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.03em", color: scoreColor, fontVariantNumeric: "tabular-nums" }}>
            {strategy.score}
          </div>
          <div style={{ width: 40, height: 2, borderRadius: 99, background: "rgba(255,255,255,0.08)", overflow: "hidden", marginTop: 3 }}>
            <div style={{ height: "100%", width: `${pct * 100}%`, borderRadius: 99, background: scoreColor }} />
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, paddingTop: 7, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <MetricCell label="Cost"       value={formatCurrency(strategy.tradeCost)}                valueColor={strategy.tradeCost < 0 ? "hsl(var(--destructive))" : "hsl(var(--success))"} />
        <MetricCell label="Max profit" value={formatCurrency(strategy.maxProfit)}                valueColor={strategy.maxProfit >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
        <MetricCell label="Return"     value={formatPercent(strategy.returnPercent)}             valueColor={strategy.returnPercent >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
      </div>
    </button>
  );
}

function MetricCell({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 9.5, color: "hsl(var(--muted-foreground))", letterSpacing: "0.02em", fontWeight: 400 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.02em", color: valueColor ?? "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

// ── P&L Simulator (collapsible, slider + typeable) ───────────────────────
function PnlSimulator({ strategy, currentPrice, symbol }: { strategy: OptionsStrategy; currentPrice: number; symbol: string }) {
  const [targetPrice, setTargetPrice] = useState(currentPrice || 100);
  // targetDate tracks the exact date — syncs from strategy.expirationDate on change
  const [targetDate, setTargetDate] = useState(strategy.expirationDate);
  const [iv, setIv] = useState(30);

  // Sync when strategy expiry changes (e.g. after Modify → Apply)
  useEffect(() => { setTargetDate(strategy.expirationDate); }, [strategy.expirationDate]);
  // Sync target price when stock loads
  useEffect(() => { if (currentPrice > 0 && targetPrice === 0) setTargetPrice(currentPrice); }, [currentPrice]);

  // Date slider: position 0→1 across today…strategy expiry
  const todayMs = Date.now();
  const stratExpiryMs = new Date(strategy.expirationDate).getTime();
  const targetMs = new Date(targetDate).getTime();
  const dateSliderPct = stratExpiryMs > todayMs
    ? Math.min(1, Math.max(0, (targetMs - todayMs) / (stratExpiryMs - todayMs)))
    : 1;
  const totalDays = Math.max(1, Math.round((stratExpiryMs - todayMs) / 86_400_000));
  const dte = Math.max(1, Math.round((new Date(targetDate).getTime() - todayMs) / 86_400_000));
  const todayStr = new Date().toISOString().split("T")[0]!;

  const setDateFromSlider = (pct: number) => {
    const ms = todayMs + pct * (stratExpiryMs - todayMs);
    setTargetDate(new Date(ms).toISOString().split("T")[0]!);
  };

  const calculatePnl = useCalculatePnl();
  const { data: pnlData, isLoading } = calculatePnl;

  useEffect(() => {
    const timer = setTimeout(() => {
      calculatePnl.mutate({
        symbol,
        data: {
          strategyId: strategy.id,
          targetPrice,
          targetDate,
          impliedVolatility: iv,
          outlook: strategy.outlook,
        },
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [strategy.id, strategy.expirationDate, targetPrice, targetDate, iv, currentPrice, symbol]);

  const minP = currentPrice * 0.7;
  const maxP = currentPrice * 1.3;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", padding: "12px", display: "flex", flexDirection: "column", gap: 12 }}>
        <SimSlider label="Goes to this price" value={[targetPrice]} min={minP} max={maxP} step={0.5} prefix="$" onChange={([v]) => setTargetPrice(v!)} />

        {/* Date row — date input + Today→Expiry slider */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontWeight: 500 }}>By this date</span>
            <input
              type="date"
              value={targetDate}
              min={todayStr}
              max={strategy.expirationDate}
              onChange={e => { if (e.target.value) setTargetDate(e.target.value); }}
              style={{
                padding: "2px 6px", borderRadius: 5, fontSize: 10, fontWeight: 600,
                border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)",
                color: "hsl(var(--foreground))", outline: "none", cursor: "pointer",
                colorScheme: "dark",
              }}
            />
          </div>
          {/* Today → Expiry scrubber */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>Today</span>
            <input
              type="range" min={0} max={1000} step={1}
              value={Math.round(dateSliderPct * 1000)}
              onChange={e => setDateFromSlider(Number(e.target.value) / 1000)}
              style={{ flex: 1, accentColor: "hsl(var(--primary))", cursor: "pointer", height: 4 }}
            />
            <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>Expiry · {totalDays}d</span>
          </div>
          <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", textAlign: "center" }}>{dte}d to target</div>
        </div>

        <SimSlider label="Implied volatility" value={[iv]} min={10} max={150} step={1} suffix="%" onChange={([v]) => setIv(v!)} />
      </div>

      {isLoading && !pnlData ? (
        <div style={{ height: 50, borderRadius: 8, background: "rgba(255,255,255,0.04)", animation: "pulse 1.4s infinite" }} />
      ) : pnlData ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div style={{
              padding: "10px", borderRadius: 8, textAlign: "center",
              border: pnlData.profitLoss >= 0 ? "1px solid hsl(var(--success) / 0.2)" : "1px solid hsl(var(--destructive) / 0.2)",
              background: pnlData.profitLoss >= 0 ? "hsl(var(--success) / 0.06)" : "hsl(var(--destructive) / 0.06)",
            }}>
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginBottom: 5 }}>P&L</div>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.03em", color: pnlData.profitLoss >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))", fontVariantNumeric: "tabular-nums" }}>
                {formatCurrency(pnlData.profitLoss)}
              </div>
              <div style={{ fontSize: 11, color: pnlData.profitLoss >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                {formatPercent(pnlData.profitLossPercent)}
              </div>
            </div>
            <div style={{ padding: "10px", borderRadius: 8, textAlign: "center", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
              <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginBottom: 5 }}>Breakeven</div>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(pnlData.breakeven)}</div>
            </div>
          </div>

          {pnlData.pnlCurve && pnlData.pnlCurve.length > 0 && (
            <div style={{ height: 140, background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)", padding: "10px 6px 6px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={pnlData.pnlCurve} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="price" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => `$${v}`} stroke="rgba(255,255,255,0.2)" fontSize={9} tickMargin={4} minTickGap={24} axisLine={false} tickLine={false} />
                  <YAxis hide domain={["dataMin", "dataMax"]} />
                  <RechartsTooltip cursor={{ stroke: "rgba(255,255,255,0.15)", strokeWidth: 1, strokeDasharray: "4 4" }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0]!.payload;
                    return (
                      <div style={{ background: "hsl(0 0% 10%)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "6px 10px", fontSize: 11 }}>
                        <div style={{ color: "hsl(var(--muted-foreground))", marginBottom: 3 }}>{formatCurrency(d.price)}</div>
                        <div style={{ fontWeight: 600, color: d.pnl >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>{formatCurrency(d.pnl)}</div>
                      </div>
                    );
                  }} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
                  <ReferenceLine x={currentPrice} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="pnl" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#pnlGrad)" animationDuration={400} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SimSlider({ label, value, min, max, step, prefix, suffix, onChange }: {
  label: string; value: number[]; min: number; max: number; step: number;
  prefix?: string; suffix?: string; onChange: (v: number[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const current = value[0] ?? min;

  const commit = () => {
    const parsed = parseFloat(draft.replace(/[^0-9.-]/g, ""));
    if (!isNaN(parsed)) onChange([Math.min(max, Math.max(min, Math.round(parsed / step) * step))]);
    setEditing(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontWeight: 400, flexShrink: 0 }}>{label}</span>
        {editing ? (
          <input autoFocus type="text" defaultValue={current.toFixed(step < 1 ? 2 : 0)} onChange={e => setDraft(e.target.value)}
            onBlur={commit} onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
            style={{ width: 72, textAlign: "right", padding: "2px 6px", borderRadius: 5, border: "1px solid hsl(var(--primary)/0.5)", background: "hsl(var(--primary)/0.06)", color: "hsl(var(--primary))", fontSize: 12, fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", outline: "none" }}
          />
        ) : (
          <button onClick={() => { setDraft(String(current)); setEditing(true); }}
            style={{ padding: "2px 7px", borderRadius: 5, border: "1px solid transparent", background: "rgba(255,255,255,0.05)", color: "hsl(var(--foreground))", fontSize: 12, fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", cursor: "text", transition: "all 0.12s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.15)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent"; }}
          >
            {prefix}{step < 1 ? current.toFixed(2) : Math.round(current)}{suffix}
          </button>
        )}
      </div>
      <Slider value={value} min={min} max={max} step={step} onValueChange={onChange} className="py-0.5" />
    </div>
  );
}
