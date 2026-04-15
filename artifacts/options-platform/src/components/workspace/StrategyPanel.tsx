import { useState, useEffect } from "react";
import { useGetStrategies, useCalculatePnl } from "@workspace/api-client-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { formatCurrency, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, BarChart2 } from "lucide-react";
import type { OptionsStrategy, GetStrategiesOutlook } from "@workspace/api-client-react";

interface StrategyPanelProps {
  symbol: string;
  currentPrice?: number;
}

const OUTLOOK_TABS: { id: GetStrategiesOutlook; label: string; color: string }[] = [
  { id: "bullish", label: "Bullish", color: "hsl(var(--success))" },
  { id: "neutral", label: "Neutral", color: "hsl(var(--primary))" },
  { id: "bearish", label: "Bearish", color: "hsl(var(--destructive))" },
];

export function StrategyPanel({ symbol, currentPrice = 0 }: StrategyPanelProps) {
  const [outlook, setOutlook] = useState<GetStrategiesOutlook>("bullish");
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null);

  const { data: strategies = [], isLoading } = useGetStrategies(symbol, { outlook }, { query: { enabled: !!symbol } });

  useEffect(() => {
    if (strategies.length > 0 && !selectedStrategyId) setSelectedStrategyId(strategies[0].id);
    else if (strategies.length === 0) setSelectedStrategyId(null);
  }, [strategies]);

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

  const selectedStrategy = strategies.find((s) => s.id === selectedStrategyId);

  return (
    <div className="flex h-full flex-col" style={{ borderLeft: "1px solid rgba(255,255,255,0.05)", background: "hsl(0 0% 5%)" }}>
      {/* Header */}
      <div style={{ padding: "16px 16px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em", color: "hsl(var(--foreground))" }}>Strategies</h2>
          <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{symbol}</span>
        </div>

        {/* Outlook tabs */}
        <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 3, marginBottom: 14 }}>
          {OUTLOOK_TABS.map((t) => {
            const active = t.id === outlook;
            return (
              <button
                key={t.id}
                onClick={() => { setOutlook(t.id); setSelectedStrategyId(null); }}
                style={{
                  flex: 1,
                  padding: "5px 0",
                  borderRadius: 6,
                  border: "none",
                  fontSize: 12,
                  fontWeight: active ? 600 : 400,
                  color: active ? t.color : "hsl(var(--muted-foreground))",
                  background: active ? `${t.color}14` : "transparent",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  letterSpacing: "-0.01em",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div style={{ padding: "10px 12px 32px", display: "flex", flexDirection: "column", gap: 6 }}>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{ height: 110, borderRadius: 8, background: "rgba(255,255,255,0.04)", animation: "pulse 1.4s infinite" }} />
            ))
          ) : strategies.length === 0 ? (
            <div style={{ padding: "40px 8px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <AlertCircle style={{ width: 22, height: 22, opacity: 0.3 }} />
              No {outlook} strategies available
            </div>
          ) : (
            strategies.map((strategy) => (
              <StrategyCard
                key={strategy.id}
                strategy={strategy}
                isSelected={strategy.id === selectedStrategyId}
                onClick={() => setSelectedStrategyId(strategy.id)}
              />
            ))
          )}

          {selectedStrategy && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 12, color: "hsl(var(--foreground))" }}>
                P&L Simulator
              </h3>
              <PnlSimulator strategy={selectedStrategy} symbol={symbol} currentPrice={currentPrice} />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function StrategyCard({ strategy, isSelected, onClick }: { strategy: OptionsStrategy; isSelected: boolean; onClick: () => void }) {
  const pct = Math.min(Math.max(strategy.score / 200, 0), 1);
  const scoreColor = strategy.score > 120 ? "hsl(var(--success))" : strategy.score < 80 ? "hsl(var(--destructive))" : "hsl(var(--primary))";

  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "12px 12px",
        borderRadius: 8,
        border: isSelected ? "1px solid hsl(var(--primary) / 0.25)" : "1px solid rgba(255,255,255,0.06)",
        background: isSelected ? "hsl(var(--primary) / 0.06)" : "rgba(255,255,255,0.025)",
        cursor: "pointer",
        transition: "all 0.12s",
      }}
      onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.045)"; }}
      onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.025)"; }}
    >
      {/* Top row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ minWidth: 0, paddingRight: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.02em", color: "hsl(var(--foreground))", marginBottom: 3 }}>
            {strategy.name}
          </div>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", display: "flex", gap: 6, alignItems: "center" }}>
            <span>{strategy.type === "income" ? "Income" : "Trade"}</span>
            <span style={{ width: 2, height: 2, borderRadius: "50%", background: "rgba(255,255,255,0.2)", flexShrink: 0 }} />
            <span>Exp {strategy.expirationDate}</span>
          </div>
        </div>
        {/* Score */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em", color: scoreColor, fontVariantNumeric: "tabular-nums" }}>
            {strategy.score}
          </span>
          <div style={{ width: 48, height: 2, borderRadius: 99, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct * 100}%`, borderRadius: 99, background: scoreColor, transition: "width 0.5s" }} />
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <MetricCell label="Cost" value={formatCurrency(strategy.tradeCost)} />
        <MetricCell label="Max Profit" value={formatCurrency(strategy.maxProfit)} valueColor="hsl(var(--success))" />
        <MetricCell label="Return" value={formatPercent(strategy.returnPercent)} valueColor="hsl(var(--primary))" />
      </div>
    </button>
  );
}

function MetricCell({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.02em", color: valueColor ?? "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function PnlSimulator({ strategy, symbol, currentPrice }: { strategy: OptionsStrategy; symbol: string; currentPrice: number }) {
  const [targetPrice, setTargetPrice] = useState(currentPrice || 100);
  const [daysToExpiry, setDaysToExpiry] = useState(30);
  const [iv, setIv] = useState(30);

  const calculatePnl = useCalculatePnl();
  const { data: pnlData, isLoading } = calculatePnl;

  const today = new Date();

  useEffect(() => {
    if (currentPrice > 0 && targetPrice === 0) setTargetPrice(currentPrice);
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysToExpiry);
    const timer = setTimeout(() => {
      calculatePnl.mutate({
        symbol,
        data: { strategyId: strategy.id, targetPrice, targetDate: targetDate.toISOString().split("T")[0], impliedVolatility: iv },
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [strategy.id, targetPrice, daysToExpiry, iv, currentPrice, symbol]);

  const minP = currentPrice * 0.7;
  const maxP = currentPrice * 1.3;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Sliders */}
      <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", padding: "14px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
        <SimSlider label="Target Price" display={formatCurrency(targetPrice)} value={[targetPrice]} min={minP} max={maxP} step={0.5} onChange={([v]) => setTargetPrice(v)} />
        <SimSlider label="Days to Expiry" display={`${daysToExpiry}d`} value={[daysToExpiry]} min={0} max={90} step={1} onChange={([v]) => setDaysToExpiry(v)} />
        <SimSlider label="Implied Volatility" display={`${iv}%`} value={[iv]} min={10} max={150} step={1} onChange={([v]) => setIv(v)} />
      </div>

      {/* Results */}
      {isLoading && !pnlData ? (
        <div style={{ height: 60, borderRadius: 8, background: "rgba(255,255,255,0.04)", animation: "pulse 1.4s infinite" }} />
      ) : pnlData ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div style={{
              padding: "12px",
              borderRadius: 8,
              border: pnlData.profitLoss >= 0 ? "1px solid hsl(var(--success) / 0.2)" : "1px solid hsl(var(--destructive) / 0.2)",
              background: pnlData.profitLoss >= 0 ? "hsl(var(--success) / 0.07)" : "hsl(var(--destructive) / 0.07)",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6, fontWeight: 500 }}>P&L</div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em", color: pnlData.profitLoss >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))", fontVariantNumeric: "tabular-nums" }}>
                {formatCurrency(pnlData.profitLoss)}
              </div>
              <div style={{ fontSize: 11, color: pnlData.profitLoss >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                {formatPercent(pnlData.profitLossPercent)}
              </div>
            </div>
            <div style={{
              padding: "12px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.025)",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6, fontWeight: 500 }}>Breakeven</div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>
                {formatCurrency(pnlData.breakeven)}
              </div>
            </div>
          </div>

          {pnlData.pnlCurve && pnlData.pnlCurve.length > 0 && (
            <div style={{ height: 160, background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)", padding: "12px 8px 8px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={pnlData.pnlCurve} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="price" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => `$${v}`} stroke="rgba(255,255,255,0.2)" fontSize={9} tickMargin={6} minTickGap={24} axisLine={false} tickLine={false} />
                  <YAxis hide domain={["dataMin", "dataMax"]} />
                  <RechartsTooltip
                    cursor={{ stroke: "rgba(255,255,255,0.15)", strokeWidth: 1, strokeDasharray: "4 4" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div style={{ background: "hsl(0 0% 10%)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "8px 10px", fontSize: 11 }}>
                          <div style={{ color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>{formatCurrency(d.price)}</div>
                          <div style={{ fontWeight: 600, color: d.pnl >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>
                            {formatCurrency(d.pnl)}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
                  <ReferenceLine x={currentPrice} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="pnl" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#pnlGrad)" animationDuration={600} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SimSlider({ label, display, value, min, max, step, onChange }: {
  label: string; display: string; value: number[]; min: number; max: number; step: number; onChange: (v: number[]) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{display}</span>
      </div>
      <Slider value={value} min={min} max={max} step={step} onValueChange={onChange} className="py-0.5" />
    </div>
  );
}
