import { useState, useEffect, useMemo } from "react";
import { useGetStrategies, useGetAccountPositions, useGetOptionsChain } from "@workspace/api-client-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { formatCurrency, formatPercent } from "@/lib/format";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, BarChart2, Minus, Pencil, Plus, X, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSettings } from "@/contexts/SettingsContext";
import type { AppSettings } from "@/lib/settings-defaults";
import type { OptionsStrategy, StrategyLeg, GetStrategiesOutlook, AccountPosition } from "@workspace/api-client-react";

interface StrategyPanelProps {
  symbol: string;
  currentPrice?: number;
  recommendedOutlook?: string;
}

const OUTLOOK_TABS: { id: GetStrategiesOutlook; label: string; color: string }[] = [
  { id: "bullish", label: "Bullish", color: "hsl(var(--success))" },
  { id: "neutral", label: "Neutral", color: "hsl(var(--primary))" },
  { id: "bearish", label: "Bearish", color: "hsl(var(--destructive))" },
];

type RiskBadge = { severity: "warning" | "danger"; label: string };
type StrategyScoreDetails = OptionsStrategy & {
  technicalScore?: number;
  ivScore?: number;
  rrScore?: number;
  popScore?: number;
  earningsRiskScore?: number;
  expectedValue?: number;
  tier?: "conservative" | "balanced" | "aggressive" | string;
  probProfit?: number;
};

function strategyCapital(strategy: OptionsStrategy, contracts: number): number {
  return Math.max(Math.abs(strategy.tradeCost), Math.abs(strategy.maxLoss)) * contracts;
}

function getRiskBadges(strategy: OptionsStrategy, contracts: number, dte: number, settings: AppSettings): RiskBadge[] {
  const badges: RiskBadge[] = [];
  const positionCapital = strategyCapital(strategy, contracts);
  const portfolioCap = Number(settings.portfolioSize || 0) * Number(settings.maxPositionPct || 0) / 100;
  const capitalCap = Math.min(
    Number.isFinite(portfolioCap) && portfolioCap > 0 ? portfolioCap : Number.POSITIVE_INFINITY,
    Number(settings.maxCapitalPerTrade || Number.POSITIVE_INFINITY),
  );
  const maxRisk = Math.abs(strategy.maxLoss) * contracts;
  const lossPct = positionCapital > 0 ? (maxRisk / positionCapital) * 100 : 0;

  if (Number.isFinite(capitalCap) && positionCapital > capitalCap) {
    badges.push({ severity: "danger", label: `Capital ${formatCurrency(positionCapital)} > ${formatCurrency(capitalCap)}` });
  }
  if (maxRisk > Number(settings.maxSingleLoss || 0)) {
    badges.push({ severity: "danger", label: `Max risk ${formatCurrency(maxRisk)} > ${formatCurrency(settings.maxSingleLoss)}` });
  }
  if (lossPct > Number(settings.maxLossPerTradePct || 0)) {
    badges.push({ severity: "warning", label: `Risk ${Math.round(lossPct)}% > ${settings.maxLossPerTradePct}%` });
  }
  if (dte < Number(settings.riskMinDTE || 0)) {
    badges.push({ severity: "warning", label: `DTE ${dte} below ${settings.riskMinDTE}` });
  }
  if (dte > Number(settings.riskMaxDTE || 0)) {
    badges.push({ severity: "warning", label: `DTE ${dte} above ${settings.riskMaxDTE}` });
  }

  return badges;
}

// â”€â”€ Black-Scholes (frontend copy for modify recalc) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function normalCDF(x: number): number {
  const a = 0.2316419;
  const k = 1 / (1 + a * Math.abs(x));
  const poly = k * (0.319381530 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
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

// â”€â”€ Payoff at expiration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  // Cost = net premium paid (negative = debit, positive = credit)
  const cost = legs.reduce((sum, l) => {
    const sign = l.action === "buy" ? -1 : 1;
    if (l.optionType === "stock") return sum + sign * l.strikePrice * l.quantity;
    return sum + sign * l.premium * 100 * l.quantity;
  }, 0);

  // Probe at-expiry payoffs at analytically important prices:
  // just below/above each strike + a very-high and very-low extreme.
  const strikes = legs.map(l => l.strikePrice);
  const probeBase = [
    currentPrice * 0.3,          // very low (all calls worthless, puts max value)
    currentPrice * 5,            // very high (all calls deep ITM)
    ...strikes.flatMap(k => [k * 0.999, k * 1.001]),  // just below and above each strike
  ].filter(p => p > 0);
  const probePayoffs = computePayoffs(legs, probeBase);
  const maxProfit = Math.round(Math.max(...probePayoffs) * 100) / 100;
  const maxLoss   = Math.round(Math.min(...probePayoffs) * 100) / 100;

  // Breakeven: fine-grained scan with linear interpolation for accuracy
  const steps = 2000;
  const allStrikes = [...strikes, currentPrice];
  const pMin = Math.min(...allStrikes) * 0.5;
  const pMax = Math.max(...allStrikes) * 1.8;
  const prices = Array.from({ length: steps + 1 }, (_, i) => pMin + (i / steps) * (pMax - pMin));
  const pnls = computePayoffs(legs, prices);

  let breakeven = currentPrice;
  for (let i = 1; i <= steps; i++) {
    const a = pnls[i - 1]!, b = pnls[i]!, pa = prices[i - 1]!, pb = prices[i]!;
    if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) {
      // Linear interpolation for sub-dollar precision
      breakeven = Math.round((pa + (pb - pa) * (-a / (b - a))) * 100) / 100;
      break;
    }
  }

  return { maxProfit, maxLoss, cost: Math.round(cost * 100) / 100, breakeven };
}

// â”€â”€ PayoffDiagram â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Strategy Detail (OptionsPlay-style card) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ScoreBreakdown
function ScoreBreakdown({ strategy }: { strategy: StrategyScoreDetails }) {
  if (strategy.technicalScore === undefined) return null;
  const factors = [
    { label: 'Technical', value: strategy.technicalScore ?? 0 },
    { label: 'IV Regime', value: strategy.ivScore ?? 0 },
    { label: 'Risk / Reward', value: strategy.rrScore ?? 0 },
    { label: 'Prob. Profit', value: strategy.popScore ?? 0 },
    { label: 'Earnings Risk', value: strategy.earningsRiskScore ?? 0 },
  ];
  const tc = strategy.tier === 'conservative' ? 'hsl(var(--success))'
    : strategy.tier === 'aggressive' ? 'hsl(var(--destructive))'
    : 'hsl(var(--primary))';
  const tb = strategy.tier === 'conservative' ? 'hsl(var(--success)/0.15)'
    : strategy.tier === 'aggressive' ? 'hsl(var(--destructive)/0.15)'
    : 'hsl(var(--primary)/0.15)';
  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '10px 12px' }}>
      <div style={{ fontSize: 9.5, fontWeight: 600, color: 'hsl(var(--muted-foreground))', marginBottom: 7, letterSpacing: '0.04em' }}>SCORE BREAKDOWN</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {factors.map(({ label, value }) => {
          const bc = value >= 7 ? 'hsl(var(--success))' : value < 4 ? 'hsl(var(--destructive))' : 'hsl(var(--primary))';
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 9.5, color: 'hsl(var(--muted-foreground))', width: 82, flexShrink: 0 }}>{label}</span>
              <div style={{ flex: 1, height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${value * 10}%`, borderRadius: 99, background: bc, transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, color: bc, width: 22, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
            </div>
          );
        })}
      </div>
      {strategy.expectedValue !== undefined && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 9.5, color: 'hsl(var(--muted-foreground))' }}>
          <span>EV</span>
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: strategy.expectedValue >= 0 ? 'hsl(var(--success))' : 'hsl(var(--destructive))' }}>
            {strategy.expectedValue >= 0 ? '+' : ''}{strategy.expectedValue.toFixed(0)}
          </span>
          {strategy.tier && (
            <span style={{ marginLeft: 4, padding: '1px 5px', borderRadius: 3, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', background: tb, color: tc }}>
              {strategy.tier.toUpperCase()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ThetaDecayChart({ dte, closeDte, profitTarget }: { dte: number; closeDte: number; profitTarget: number }) {
  const W = 300, H = 58;
  const maxDte = Math.max(dte, closeDte, 60);
  const points = Array.from({ length: 28 }, (_, i) => {
    const x = (i / 27) * W;
    const remaining = maxDte - (i / 27) * maxDte;
    const decay = Math.pow(1 - remaining / maxDte, 1.65);
    const y = 48 - decay * 38;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  const closeX = W * (1 - closeDte / maxDte);
  return (
    <div style={{ padding: "0 10px 8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 9.5, color: "hsl(var(--muted-foreground))" }}>
        <span>Theta decay</span>
        <span>Close at {profitTarget}% profit or {closeDte} DTE</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", borderRadius: 6, background: "rgba(0,0,0,0.24)" }}>
        <path d={points} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" />
        <line x1={closeX} x2={closeX} y1="8" y2="52" stroke="hsl(38 92% 50%)" strokeWidth="1" strokeDasharray="3 4" />
        <line x1="0" x2={W} y1="48" y2="48" stroke="rgba(255,255,255,0.10)" />
      </svg>
    </div>
  );
}

function StrategyDetail({
  strategy, currentPrice, symbol, iv, contracts, onContractsChange, onModify,
}: {
  strategy: OptionsStrategy;
  currentPrice: number;
  symbol: string;
  iv: number;
  contracts: number;
  onContractsChange: (n: number) => void;
  onModify: () => void;
}) {
  const { toast } = useToast();
  const { settings } = useSettings();

  const exp = strategy.expirationDate;
  const dte = Math.max(0, Math.round((new Date(exp).getTime() - Date.now()) / 86_400_000));

  const hasStockLeg = strategy.legs.some(l => l.optionType === "stock");
  const isCredit = strategy.type === "income" && strategy.tradeCost > 0 && !hasStockLeg;

  // Use real BS-derived POP when available, otherwise approximate
  const scoredStrategy = strategy as StrategyScoreDetails;
  const pop = scoredStrategy.probProfit !== undefined
    ? Math.round(scoredStrategy.probProfit * 100)
    : strategy.type === 'income'
      ? Math.min(85, Math.max(20, Math.round((Math.abs(strategy.tradeCost) / Math.max(1, Math.abs(strategy.tradeCost) + Math.abs(strategy.maxLoss))) * 100)))
      : Math.min(75, Math.max(25, Math.round(42 + (strategy.score - 50) * 0.30)));

  const riskBadges = settings.showRiskWarnings ? getRiskBadges(strategy, contracts, dte, settings) : [];
  const suggestedCapital = Math.min(
    Number(settings.maxCapitalPerTrade || 0),
    Number(settings.portfolioSize || 0) * Number(settings.maxPositionPct || 0) / 100,
  );
  const suggestedContracts = Math.max(1, Math.floor(suggestedCapital / Math.max(1, strategyCapital(strategy, 1))));

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, background: "rgba(255,255,255,0.02)", overflow: "hidden" }}>
      {/* Strategy name bar */}
      <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "-0.01em", color: "hsl(var(--foreground))", lineHeight: 1.35 }}>
          {strategy.name}
        </div>
        <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
          {strategy.type === "income" ? "Income" : "Trade"} Â· Exp {exp}
        </div>
        {(riskBadges.length > 0 || settings.showPositionSizingSuggestion) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {settings.showPositionSizingSuggestion && suggestedCapital > 0 && (
              <span style={{ fontSize: 9.5, fontWeight: 700, padding: "3px 6px", borderRadius: 5, color: "hsl(var(--primary))", background: "hsl(var(--primary) / 0.12)", border: "1px solid hsl(var(--primary) / 0.22)" }}>
                Suggested {formatCurrency(suggestedCapital)} / {suggestedContracts} contract{suggestedContracts === 1 ? "" : "s"}
              </span>
            )}
            {riskBadges.map((badge) => (
              <span key={badge.label} style={{ fontSize: 9.5, fontWeight: 700, padding: "3px 6px", borderRadius: 5, color: badge.severity === "danger" ? "hsl(var(--destructive))" : "hsl(38 92% 50%)", background: badge.severity === "danger" ? "hsl(var(--destructive) / 0.10)" : "hsl(38 92% 50% / 0.10)", border: badge.severity === "danger" ? "1px solid hsl(var(--destructive) / 0.24)" : "1px solid hsl(38 92% 50% / 0.24)" }}>
                {badge.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Payoff diagram */}
      <div style={{ padding: "10px 10px 8px" }}>
        <PayoffDiagram legs={strategy.legs} currentPrice={currentPrice} />
      </div>
      {settings.showThetaDecayCurve && (
        <ThetaDecayChart dte={dte} closeDte={settings.thetaCloseDTE} profitTarget={settings.thetaCloseProfitPct} />
      )}

      {/* Metrics grid */}
      {(() => {
        const metrics = [
          {
            label: isCredit ? "Credit Received" : hasStockLeg ? "Net Cost" : "Cost",
            value: formatCurrency(Math.abs(strategy.tradeCost) * contracts),
            color: isCredit ? "hsl(var(--success))" : hasStockLeg ? "hsl(var(--foreground))" : "hsl(var(--destructive))",
          },
          { label: "Max reward",  value: formatCurrency(strategy.maxProfit * contracts), color: strategy.maxProfit >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))" },
          { label: "Max risk",    value: formatCurrency(Math.abs(strategy.maxLoss) * contracts), color: "hsl(var(--destructive))" },
          ...(settings.showDailyThetaDecay ? [{ label: "Theta / day", value: settings.showThetaAsDollarsPerDay ? formatCurrency((strategy.tradeCost / Math.max(1, dte)) * contracts) : ((strategy.tradeCost / Math.max(1, dte))).toFixed(settings.greeksPrecision), color: dte <= settings.thetaDecayWarningThresholdDte ? "hsl(38 92% 50%)" : "hsl(var(--foreground))" }] : []),
          ...(settings.showProbabilityOfProfit ? [{ label: "POP", value: `${pop}%`, color: pop >= 60 ? "hsl(var(--success))" : "hsl(var(--foreground))" }] : []),
          { label: "Breakeven",   value: formatCurrency(strategy.breakeven), color: "hsl(var(--foreground))" },
          { label: "Days to exp", value: `${dte}`, color: "hsl(var(--foreground))" },
        ];
        const lastRowStart = Math.floor((metrics.length - 1) / 2) * 2;
        return (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            {metrics.map((m, i) => (
              <div key={i} style={{
                padding: "9px 12px",
                borderRight: i % 2 === 0 ? "1px solid rgba(255,255,255,0.05)" : undefined,
                borderBottom: i < lastRowStart ? "1px solid rgba(255,255,255,0.05)" : undefined,
                display: "flex", flexDirection: "column", gap: 3,
              }}>
                <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontWeight: 400 }}>{m.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.02em", color: m.color, fontVariantNumeric: "tabular-nums" }}>{m.value}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Score breakdown */}
      <ScoreBreakdown strategy={strategy} />

      {/* Action buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <button
          onClick={() => toast({ title: "Trade order", description: "Broker connection needed â€” add Schwab credentials to execute." })}
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

      {/* P&L Simulator */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: "10px 12px 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 10 }}>P&amp;L Simulator</div>
        <PnlSimulator strategy={strategy} currentPrice={currentPrice} symbol={symbol} initialIv={iv} contracts={contracts} onContractsChange={onContractsChange} />
      </div>
    </div>
  );
}

// â”€â”€ Modify Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // Re-price all legs whenever the expiry date changes (new T â†’ new option values)
  useEffect(() => {
    setLegs(prev => prev.map(l => {
      if (l.optionType === "stock") return l;
      const premium = Math.round(bsPrice(currentPrice, l.strikePrice, T, sigma, l.optionType as "call" | "put") * 100) / 100;
      return { ...l, premium: Math.max(0.01, premium) };
    }));
  }, [expStr]);

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

  // Format new expiry label for the strategy name, e.g. "Jun 18"
  const newExpLabel = new Date(expStr + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const apply = () => {
    // Replace the leading date label in the name (e.g. "Jun 5 265/285â€¦" â†’ "Jun 18 265/285â€¦")
    const newName = strategy.name.replace(/^[A-Z][a-z]+ \d+\s/, `${newExpLabel} `);
    const updated: OptionsStrategy = {
      ...strategy,
      name: newName,
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
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginBottom: 5 }}>Expiry Â· {dte}d</div>
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
        {(() => {
          const mHasStock = legs.some(l => l.optionType === "stock");
          const mIsCredit = updatedMetrics.cost > 0 && !mHasStock;
          return [
            {
              label: mIsCredit ? "Credit" : mHasStock ? "Net Cost" : "Cost",
              value: formatCurrency(Math.abs(updatedMetrics.cost)),
              color: mIsCredit ? "hsl(var(--success))" : mHasStock ? "hsl(var(--foreground))" : "hsl(var(--destructive))",
            },
            { label: "Max reward", value: formatCurrency(updatedMetrics.maxProfit),  color: updatedMetrics.maxProfit >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))" },
            { label: "Max risk",   value: formatCurrency(Math.abs(updatedMetrics.maxLoss)), color: "hsl(var(--destructive))" },
          ];
        })().map((m, i) => (
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

// â”€â”€ Existing Position Banner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ExistingPositionBanner({
  position, onUseEntryPrice,
}: {
  position: AccountPosition;
  onUseEntryPrice: (price: number) => void;
}) {
  const { settings } = useSettings();
  const isUp = position.totalPnl >= 0;
  const pnlColor = isUp ? "hsl(var(--success))" : "hsl(var(--destructive))";
  // Average entry price across all legs (weighted by quantity)
  const avgEntry = position.legs.reduce((s, l) => s + l.openPrice * l.quantity, 0)
    / Math.max(1, position.legs.reduce((s, l) => s + l.quantity, 0));

  return (
    <div style={{
      margin: "0 0 10px",
      padding: "10px 12px",
      borderRadius: 8,
      border: "1px solid hsl(var(--primary)/0.25)",
      background: "hsl(var(--primary)/0.06)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <TrendingUp style={{ width: 12, height: 12, color: "hsl(var(--primary))" }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--primary))" }}>Existing Position</span>
        <span style={{
          fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 3,
          background: "rgba(255,255,255,0.08)", color: "hsl(var(--muted-foreground))", marginLeft: 2,
        }}>
          {position.strategyType}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>Strikes</div>
          <div style={{ fontSize: 11, fontWeight: 600 }}>{position.strikesLabel}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>Expiry</div>
          <div style={{ fontSize: 11, fontWeight: 600 }}>{position.expiration}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>DTE</div>
          <div style={{ fontSize: 11, fontWeight: 600 }}>{position.dte}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>P&L</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: pnlColor, fontVariantNumeric: "tabular-nums" }}>
            {isUp ? "+" : ""}{formatCurrency(position.totalPnl)}
          </div>
        </div>
      </div>
      {settings.showPortfolioGreeksSummary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(52px,1fr))", gap: 6, paddingTop: 7, borderTop: "1px solid rgba(255,255,255,0.06)", marginBottom: 8 }}>
          {[
            settings.showDelta ? { label: "Delta", value: (position.greeks.delta >= 0 ? "+" : "") + position.greeks.delta.toFixed(settings.greeksPrecision) } : null,
            settings.showTheta ? { label: "Theta", value: settings.showThetaAsDollarsPerDay ? `${formatCurrency(position.greeks.theta)}/d` : position.greeks.theta.toFixed(settings.greeksPrecision) } : null,
            settings.showGamma ? { label: "Gamma", value: position.greeks.gamma.toFixed(settings.greeksPrecision) } : null,
            settings.showVega ? { label: "Vega", value: settings.greeksDisplayFormat === "perShare" ? position.greeks.vega.toFixed(settings.greeksPrecision) : formatCurrency(position.greeks.vega) } : null,
            settings.showRho ? { label: "Rho", value: settings.greeksDisplayFormat === "perShare" ? (Number((position.greeks as any).rho ?? 0)).toFixed(settings.greeksPrecision) : formatCurrency(Number((position.greeks as any).rho ?? 0)) } : null,
          ].filter(Boolean).map((g, i) => (
            <div key={i}>
              <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>{g!.label}</div>
              <div style={{ fontSize: 10.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{g!.value}</div>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={() => onUseEntryPrice(avgEntry)}
        style={{
          width: "100%", padding: "5px 0", borderRadius: 5, fontSize: 10, fontWeight: 600,
          border: "1px solid hsl(var(--primary)/0.3)", background: "hsl(var(--primary)/0.08)",
          color: "hsl(var(--primary))", cursor: "pointer", letterSpacing: "-0.01em",
        }}
      >
        Use entry price ({formatCurrency(avgEntry)}) in P&L simulator
      </button>
    </div>
  );
}


export function StrategyPanel({ symbol, currentPrice = 0, recommendedOutlook }: StrategyPanelProps) {
  const { settings } = useSettings();
  const initialOutlook: GetStrategiesOutlook =
    recommendedOutlook === "bearish" ? "bearish" :
    recommendedOutlook === "neutral" ? "neutral" : "bullish";
  const [outlook, setOutlook] = useState<GetStrategiesOutlook>(initialOutlook);
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null);
  const [modifying, setModifying] = useState(false);
  const [customStrategies, setCustomStrategies] = useState<Record<string, OptionsStrategy>>({});
  const [entryPriceOverride, setEntryPriceOverride] = useState<number | null>(null);
  const [contractsByStrategy, setContractsByStrategy] = useState<Record<string, number>>({});

  const { data: strategies = [], isLoading } = useGetStrategies(symbol, { outlook }, { query: { enabled: !!symbol } });
  const { data: positionsData } = useGetAccountPositions({ query: { enabled: !!symbol } });
  const { data: chainData } = useGetOptionsChain(symbol, { query: { enabled: !!symbol } });

  // Find existing positions for this symbol (pick closest DTE if multiple)
  const existingPosition = useMemo(() => {
    if (!positionsData?.positions || !symbol) return null;
    const matches = positionsData.positions.filter(p => p.underlying === symbol);
    if (matches.length === 0) return null;
    return matches.reduce((best, p) => p.dte < best.dte ? p : best);
  }, [positionsData, symbol]);

  // Get ATM IV from TT chain for the closest-to-45-DTE expiry
  const chainIv = useMemo(() => {
    if (!chainData || !currentPrice || currentPrice <= 0) return null;
    const targetDte = 45;
    const expiry = chainData.expirations.reduce((best, e) =>
      Math.abs(e.daysToExpiration - targetDte) < Math.abs(best.daysToExpiration - targetDte) ? e : best,
    chainData.expirations[0]!);
    if (!expiry) return null;
    const calls = expiry.contracts.filter(c => c.optionType === "call" && c.impliedVolatility > 0);
    if (calls.length === 0) return null;
    const atm = calls.reduce((best, c) =>
      Math.abs(c.strikePrice - currentPrice) < Math.abs(best.strikePrice - currentPrice) ? c : best,
    );
    return Math.round(atm.impliedVolatility);
  }, [chainData, currentPrice]);

  const displayStrategies = useMemo(() => {
    return [...strategies]
      .map((strategy) => customStrategies[`${symbol}:${outlook}:${strategy.id}`] ?? strategy)
      .sort((a, b) => b.score - a.score);
  }, [customStrategies, outlook, strategies, symbol]);

  useEffect(() => {
    const hasSelected = selectedStrategyId !== null && displayStrategies.some((strategy) => strategy.id === selectedStrategyId);
    if (displayStrategies.length > 0 && !hasSelected) setSelectedStrategyId(displayStrategies[0]!.id);
    else if (strategies.length === 0) setSelectedStrategyId(null);
    setModifying(false);
  }, [displayStrategies, selectedStrategyId, strategies.length, outlook]);

  // Sync outlook tab when stock changes to a different recommendedOutlook
  useEffect(() => {
    if (!recommendedOutlook) return;
    const next: GetStrategiesOutlook =
      recommendedOutlook === "bearish" ? "bearish" :
      recommendedOutlook === "neutral" ? "neutral" : "bullish";
    setOutlook(next);
    setSelectedStrategyId(null);
  }, [symbol, recommendedOutlook]);

  // Reset entry price override whenever symbol changes
  useEffect(() => { setEntryPriceOverride(null); }, [symbol]);

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
  const defaultContracts = Math.max(1, Number(settings.defaultContracts || 1));
  const selectedContracts = contractsByStrategy[customKey] ?? defaultContracts;
  const setSelectedContracts = (next: number) => {
    setContractsByStrategy(prev => ({ ...prev, [customKey]: Math.max(1, Math.round(next || 1)) }));
  };

  // Prefer real TT IV from chain; fall back to Brenner-Subrahmanyam back-calculation
  const estimatedIv = (() => {
    if (chainIv !== null) return chainIv;
    if (!selectedStrategy || currentPrice <= 0) return 30;
    const atmLeg = selectedStrategy.legs.find(l => l.optionType !== "stock" && l.action === "buy");
    if (!atmLeg || atmLeg.premium <= 0) return 30;
    const T0 = Math.max(0.01, (new Date(selectedStrategy.expirationDate).getTime() - Date.now()) / (365 * 24 * 60 * 60 * 1000));
    const iv = (atmLeg.premium * Math.sqrt(2 * Math.PI)) / (currentPrice * Math.sqrt(T0)) * 100;
    return Math.round(Math.min(120, Math.max(10, iv)));
  })();

  return (
    <div className="flex h-full flex-col" style={{ borderLeft: "1px solid rgba(255,255,255,0.05)", background: "hsl(0 0% 5%)" }}>
      {/* Header */}
      <div style={{ padding: "16px 16px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em" }}>Strategies</h2>
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
          ) : displayStrategies.length === 0 ? (
            <div style={{ padding: "40px 8px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <AlertCircle style={{ width: 22, height: 22, opacity: 0.3 }} />
              No {outlook} strategies available
            </div>
          ) : (() => {
            const topId = displayStrategies[0]!.id;
            return displayStrategies.map((strategy) => {
              const contractKey = `${symbol}:${outlook}:${strategy.id}`;
              const contracts = contractsByStrategy[contractKey] ?? defaultContracts;
              return (
                <StrategyCard
                  key={strategy.id}
                  strategy={strategy}
                  contracts={contracts}
                  isSelected={strategy.id === selectedStrategyId}
                  isModified={Boolean(customStrategies[contractKey])}
                  isTopPick={strategy.id === topId}
                  onClick={() => { setSelectedStrategyId(strategy.id); setModifying(false); }}
                />
              );
            });
          })()}

          {/* Existing position banner */}
          {existingPosition && !isLoading && (
            <ExistingPositionBanner
              position={existingPosition}
              onUseEntryPrice={(price) => setEntryPriceOverride(price)}
            />
          )}

          {/* Detail / Modify area */}
          {selectedStrategy && !isLoading && (
            <div style={{ marginTop: existingPosition ? 0 : 10 }}>
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
                  currentPrice={entryPriceOverride ?? currentPrice}
                  symbol={symbol}
                  iv={estimatedIv}
                  contracts={selectedContracts}
                  onContractsChange={setSelectedContracts}
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

// â”€â”€ Strategy Card (compact list item) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function StrategyCard({ strategy, contracts, isSelected, isModified, isTopPick, onClick }: {
  strategy: OptionsStrategy; contracts: number; isSelected: boolean; isModified: boolean; isTopPick: boolean; onClick: () => void;
}) {
  const pct = Math.min(Math.max(strategy.score / 100, 0), 1);
  const scoreColor = strategy.score > 65 ? "hsl(var(--success))" : strategy.score < 40 ? "hsl(var(--destructive))" : "hsl(var(--primary))";
  const topBorder = isTopPick && !isSelected ? "1px solid hsl(var(--success) / 0.25)" : isSelected ? "1px solid hsl(var(--primary) / 0.3)" : "1px solid rgba(255,255,255,0.06)";

  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 8,
        border: topBorder,
        background: isSelected ? "hsl(var(--primary) / 0.07)" : isTopPick ? "hsl(var(--success) / 0.04)" : "rgba(255,255,255,0.025)",
        cursor: "pointer", transition: "all 0.12s",
      }}
      onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.045)"; }}
      onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = isTopPick ? "hsl(var(--success) / 0.04)" : "rgba(255,255,255,0.025)"; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ minWidth: 0, paddingRight: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "-0.02em", color: "hsl(var(--foreground))", marginBottom: 2, display: "flex", alignItems: "center", gap: 5 }}>
            {strategy.name}
            {isTopPick && (
              <span style={{ fontSize: 8.5, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "hsl(var(--success)/0.18)", color: "hsl(var(--success))", letterSpacing: "0.03em", flexShrink: 0 }}>
                TOP PICK
              </span>
            )}
            {isModified && (
              <span style={{ fontSize: 8.5, fontWeight: 600, padding: "1px 4px", borderRadius: 3, background: "hsl(var(--primary)/0.15)", color: "hsl(var(--primary))", letterSpacing: "0.03em" }}>
                MODIFIED
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", display: "flex", gap: 5, alignItems: "center" }}>
            <span>{strategy.type === "income" ? "Income" : "Trade"}</span>
            <span style={{ opacity: 0.3 }}>Â·</span>
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
        <MetricCell label="Cost"       value={formatCurrency(strategy.tradeCost * contracts)}    valueColor={strategy.tradeCost < 0 ? "hsl(var(--destructive))" : "hsl(var(--success))"} />
        <MetricCell label="Max profit" value={formatCurrency(strategy.maxProfit * contracts)}    valueColor={strategy.maxProfit >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
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

// â”€â”€ Client-side P&L curve (uses actual modified legs + bsPrice) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function computePnlClient(
  legs: StrategyLeg[],
  strategyExpirationDate: string,
  targetPrice: number,
  targetDate: string,
  iv: number,
  currentPrice: number,
  settings: AppSettings,
) {
  const ivDecimal = Math.max(0.05, iv / 100);
  const targetMs  = new Date(targetDate).getTime();
  const multiplier = Math.max(1, Number(settings.contractMultiplier || 100));
  const optionLegs = legs.filter(l => l.optionType !== "stock");
  const optionContracts = optionLegs.reduce((sum, leg) => sum + Math.abs(leg.quantity), 0);
  const commissionImpact = settings.includeCommissionsInPnl
    ? optionContracts * Number(settings.commissionPerContract || 0) + optionLegs.length * Number(settings.perLegCommission || 0)
    : 0;
  const feeImpact = optionContracts * Number(settings.exchangeFeePerContract || 0);
  const totalFeeImpact = commissionImpact + feeImpact;

  const evalAtPrice = (S: number): number =>
    legs.reduce((total, leg) => {
      if (leg.optionType === "stock") {
        return total + (S - leg.strikePrice) * leg.quantity * (leg.action === "buy" ? 1 : -1);
      }
      // Use per-leg expiry if available (set by Modify), else fall back to strategy expiry
      const legExpiry = (leg as any).expiration ?? strategyExpirationDate;
      const legT = Math.max(0, (new Date(legExpiry).getTime() - targetMs) / (365 * 24 * 60 * 60 * 1000));
      const optVal  = bsPrice(S, leg.strikePrice, legT, ivDecimal, leg.optionType as "call" | "put") * multiplier;
      const openVal = leg.premium * multiplier;
      return total + (optVal - openVal) * (leg.action === "buy" ? 1 : -1) * leg.quantity;
    }, 0) - totalFeeImpact;

  // Curve spanning Â±30 % around current price, 80 points
  const lo = currentPrice * 0.7;
  const hi = currentPrice * 1.3;
  const POINTS = Number(settings.pnlCurveResolution || 100);
  const pnlCurve = Array.from({ length: POINTS + 1 }, (_, i) => {
    const price = lo + (i / POINTS) * (hi - lo);
    return { price: Math.round(price * 100) / 100, pnl: Math.round(evalAtPrice(price) * 100) / 100 };
  });

  const profitLoss = Math.round(evalAtPrice(targetPrice) * 100) / 100;

  // Cost = net premium outflow (for % calculation)
  const cost = legs.reduce((s, l) => {
    if (l.optionType === "stock") return s;
    return s + l.premium * multiplier * (l.action === "buy" ? 1 : -1);
  }, 0);
  const profitLossPercent = cost !== 0 ? Math.round((profitLoss / Math.abs(cost)) * 10000) / 100 : 0;

  // Breakeven (nearest zero crossing in curve)
  let breakeven = currentPrice;
  for (let i = 1; i < pnlCurve.length; i++) {
    const a = pnlCurve[i - 1]!, b = pnlCurve[i]!;
    if ((a.pnl < 0 && b.pnl >= 0) || (a.pnl > 0 && b.pnl <= 0)) {
      breakeven = Math.round((a.price + (b.price - a.price) * (-a.pnl / (b.pnl - a.pnl))) * 100) / 100;
      break;
    }
  }

  return { profitLoss, profitLossPercent, breakeven, pnlCurve, commissionImpact: totalFeeImpact };
}

// â”€â”€ P&L Simulator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function PnlSimulator({
  strategy, currentPrice, symbol: _symbol, initialIv = 30,
  contracts, onContractsChange,
}: {
  strategy: OptionsStrategy; currentPrice: number; symbol: string; initialIv?: number;
  contracts: number; onContractsChange: (n: number) => void;
}) {
  const { settings } = useSettings();
  const [targetPrice, setTargetPrice] = useState(currentPrice || 100);
  const [targetDate, setTargetDate] = useState(strategy.expirationDate);
  const [iv, setIv] = useState(settings.useHistoricalVolatilityForSimulation ? Math.max(10, initialIv * 0.8) : initialIv);
  const [dollarDraft, setDollarDraft] = useState<string | null>(null);

  // Sync when strategy expiry changes (e.g. after Modify â†’ Apply)
  useEffect(() => { setTargetDate(strategy.expirationDate); }, [strategy.expirationDate]);
  // Sync IV when strategy changes (different strategies may have different estimated IVs)
  useEffect(() => { setIv(settings.useHistoricalVolatilityForSimulation ? Math.max(10, initialIv * 0.8) : initialIv); }, [initialIv, settings.useHistoricalVolatilityForSimulation]);
  useEffect(() => { if (currentPrice > 0 && targetPrice === 0) setTargetPrice(currentPrice); }, [currentPrice]);

  // Net cost per contract (absolute value of net debit/credit Ã— 100)
  const costPerContract = Math.abs(
    strategy.legs
      .filter(l => l.optionType !== "stock")
      .reduce((s, l) => s + l.premium * settings.contractMultiplier * (l.action === "buy" ? 1 : -1), 0)
  );
  const dollarAmount = Math.round(contracts * costPerContract * 100) / 100;

  const commitDollar = (raw: string) => {
    const val = parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (!isNaN(val) && costPerContract > 0) {
      onContractsChange(Math.max(1, Math.round(val / costPerContract)));
    }
    setDollarDraft(null);
  };

  const pnlData = useMemo(
    () => computePnlClient(strategy.legs, strategy.expirationDate, targetPrice, targetDate, iv, currentPrice, settings),
    [strategy.legs, strategy.expirationDate, targetPrice, targetDate, iv, currentPrice, settings],
  );
  const scaledCurve = useMemo(
    () => pnlData.pnlCurve.map(p => ({ ...p, pnl: Math.round(p.pnl * contracts * 100) / 100 })),
    [pnlData.pnlCurve, contracts],
  );

  // Date slider: position 0â†’1 across todayâ€¦strategy expiry
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

  const minP = currentPrice * 0.7;
  const maxP = currentPrice * 1.3;
  const scaledPnls = scaledCurve.map(point => point.pnl);
  const maxProfit = Math.max(...scaledPnls);
  const maxLoss = Math.min(...scaledPnls);
  const profitTarget = Math.abs(strategy.maxProfit * contracts) * (settings.defaultProfitTargetPct / 100);
  const stopLoss = -Math.abs(strategy.maxLoss * contracts) * (settings.defaultStopLossPct / 100);
  const showAmount = settings.pnlDisplayMode === "amount" || settings.pnlDisplayMode === "both";
  const showPercent = settings.pnlDisplayMode === "percent" || settings.pnlDisplayMode === "both";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", padding: "12px", display: "flex", flexDirection: "column", gap: 12 }}>
        <SimSlider label="Goes to this price" value={[targetPrice]} min={minP} max={maxP} step={0.5} prefix="$" onChange={([v]) => setTargetPrice(v!)} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button type="button" onClick={() => setTargetPrice(Math.round(currentPrice * (1 + settings.scenarioUnderlyingMovePct / 100) * 100) / 100)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "hsl(var(--success))", fontSize: 10, fontWeight: 700 }}>+{settings.scenarioUnderlyingMovePct}% scenario</button>
          <button type="button" onClick={() => setTargetPrice(Math.round(currentPrice * (1 - settings.scenarioUnderlyingMovePct / 100) * 100) / 100)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "hsl(var(--destructive))", fontSize: 10, fontWeight: 700 }}>-{settings.scenarioUnderlyingMovePct}% scenario</button>
        </div>

        {/* Date row â€” date input + Todayâ†’Expiry slider */}
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
          {/* Today â†’ Expiry scrubber */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>Today</span>
            <input
              type="range" min={0} max={1000} step={1}
              value={Math.round(dateSliderPct * 1000)}
              onChange={e => setDateFromSlider(Number(e.target.value) / 1000)}
              style={{ flex: 1, accentColor: "hsl(var(--primary))", cursor: "pointer", height: 4 }}
            />
            <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>Expiry Â· {totalDays}d</span>
          </div>
          <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", textAlign: "center" }}>{dte}d to target</div>
        </div>

        <SimSlider label="Implied volatility" value={[iv]} min={10} max={150} step={1} suffix="%" onChange={([v]) => setIv(v!)} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button type="button" onClick={() => setIv(Math.min(150, iv + settings.scenarioIvChangePct))} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "hsl(var(--primary))", fontSize: 10, fontWeight: 700 }}>+{settings.scenarioIvChangePct}% IV</button>
          <button type="button" onClick={() => setIv(Math.max(10, iv - settings.scenarioIvChangePct))} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "hsl(var(--primary))", fontSize: 10, fontWeight: 700 }}>-{settings.scenarioIvChangePct}% IV</button>
        </div>
        {settings.showGreeksImpactInScenario && (
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
            Scenario step: {settings.scenarioDteStepDays}d Â· Risk-free {settings.riskFreeRatePct}% Â· Dividend {settings.dividendYieldAssumptionPct}%
          </div>
        )}
      </div>

      {/* Position size */}
      <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: "hsl(var(--muted-foreground))", letterSpacing: "0.05em", textTransform: "uppercase" }}>Position Size</span>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>Dollar Amount</span>
            <input
              type="text"
              inputMode="decimal"
              value={dollarDraft !== null ? dollarDraft : (dollarAmount > 0 ? `$${dollarAmount.toFixed(0)}` : "â€”")}
              onFocus={() => setDollarDraft(dollarAmount > 0 ? dollarAmount.toFixed(0) : "")}
              onChange={e => setDollarDraft(e.target.value)}
              onBlur={e => commitDollar(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") commitDollar((e.target as HTMLInputElement).value); if (e.key === "Escape") setDollarDraft(null); }}
              style={{
                padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)", color: "hsl(var(--foreground))",
                fontSize: 12, fontWeight: 600, outline: "none", fontVariantNumeric: "tabular-nums",
                width: "100%", boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>Contracts</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                onClick={() => onContractsChange(Math.max(1, contracts - 1))}
                style={{ width: 24, height: 28, borderRadius: 5, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "hsl(var(--foreground))", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              ><Minus style={{ width: 10, height: 10 }} /></button>
              <input
                type="number" min={1} step={1}
                value={contracts}
                onChange={e => onContractsChange(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                style={{
                  flex: 1, padding: "5px 6px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)", color: "hsl(var(--foreground))",
                  fontSize: 12, fontWeight: 600, outline: "none", textAlign: "center",
                  fontVariantNumeric: "tabular-nums", minWidth: 0,
                }}
              />
              <button
                onClick={() => onContractsChange(contracts + 1)}
                style={{ width: 24, height: 28, borderRadius: 5, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "hsl(var(--foreground))", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              ><Plus style={{ width: 10, height: 10 }} /></button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <div style={{
            padding: "10px", borderRadius: 8, textAlign: "center",
            border: (pnlData.profitLoss * contracts) >= 0 ? "1px solid hsl(var(--success) / 0.2)" : "1px solid hsl(var(--destructive) / 0.2)",
            background: (pnlData.profitLoss * contracts) >= 0 ? "hsl(var(--success) / 0.06)" : "hsl(var(--destructive) / 0.06)",
          }}>
            <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginBottom: 5 }}>P&L</div>
            {showAmount && <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.03em", color: pnlData.profitLoss >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))", fontVariantNumeric: "tabular-nums" }}>
              {formatCurrency(pnlData.profitLoss * contracts)}
            </div>}
            {showPercent && <div style={{ fontSize: 11, color: pnlData.profitLoss >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
              {formatPercent(pnlData.profitLossPercent)}
            </div>}
            {pnlData.commissionImpact > 0 && <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", marginTop: 3 }}>Fees: {formatCurrency(pnlData.commissionImpact * contracts)}</div>}
          </div>
          <div style={{ padding: "10px", borderRadius: 8, textAlign: "center", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
            <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginBottom: 5 }}>Breakeven</div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(pnlData.breakeven)}</div>
          </div>
        </div>

        <div style={{ height: 140, background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)", padding: "10px 6px 6px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={scaledCurve} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
              {settings.showCurrentPriceOnPnlCurve && <ReferenceLine x={currentPrice} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" />}
              {settings.showBreakevenOnPnlCurve && <ReferenceLine x={pnlData.breakeven} stroke="hsl(var(--primary))" strokeDasharray="4 4" />}
              {settings.showMaxProfitOnPnlCurve && Number.isFinite(maxProfit) && <ReferenceLine y={maxProfit} stroke="hsl(var(--success))" strokeOpacity={0.35} strokeDasharray="4 4" />}
              {settings.showMaxLossOnPnlCurve && Number.isFinite(maxLoss) && <ReferenceLine y={maxLoss} stroke="hsl(var(--destructive))" strokeOpacity={0.35} strokeDasharray="4 4" />}
              {settings.showProfitTargetLine && <ReferenceLine y={profitTarget} stroke="hsl(var(--success))" strokeDasharray="6 5" />}
              {settings.showStopLossLine && <ReferenceLine y={stopLoss} stroke="hsl(var(--destructive))" strokeDasharray="6 5" />}
              {pnlData.commissionImpact > 0 && <ReferenceLine y={-pnlData.commissionImpact * contracts} stroke="hsl(38 92% 50%)" strokeOpacity={0.55} strokeDasharray="2 4" />}
              <Area type="monotone" dataKey="pnl" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#pnlGrad)" animationDuration={400} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
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
