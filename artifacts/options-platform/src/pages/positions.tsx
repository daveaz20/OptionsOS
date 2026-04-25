import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSettings } from "@/contexts/SettingsContext";
import { useGetAccountBalances, useGetAccountPositions } from "@workspace/api-client-react";
import type { AccountPosition } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Target,
} from "lucide-react";
import { Link } from "wouter";

type SortKey = "openDate" | "pnlAbs" | "pnlPct" | "dte" | "symbol" | "theta";
type PositionAlert = { type: string; label: string; severity: "success" | "danger" | "warning" };
type ExtendedPosition = AccountPosition & {
  sector?: string;
  openedAt?: string;
  daysInTrade?: number | null;
  realizedPnl?: number;
  maxProfitPnlPercent?: number;
  alerts?: PositionAlert[];
};
type PositionStats = {
  period: string;
  closedPositions: Array<{ id: string; symbol: string; closedAt: string; description: string; pnl: number }>;
  totalClosed: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
};

const GROUP_LABELS: Record<string, string> = {
  underlying: "Underlying",
  strategy: "Strategy",
  sector: "Sector",
  expiration: "Expiration",
  none: "All Positions",
};

function syncIntervalMs(value: string, autoSync: boolean) {
  if (!autoSync) return undefined;
  if (value === "manual") return undefined;
  if (value === "5m") return 5 * 60 * 1000;
  if (value === "15m") return 15 * 60 * 1000;
  return 60 * 1000;
}

function pnlTone(position: ExtendedPosition) {
  return position.totalPnl >= 0;
}

function pnlColor(positive: boolean, scheme: string) {
  if (scheme === "blueOrange") {
    return positive ? "hsl(199 89% 58%)" : "hsl(30 95% 60%)";
  }
  return positive ? "hsl(var(--success))" : "hsl(var(--destructive))";
}

function formatDate(value?: string | null) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function sortPositions(positions: ExtendedPosition[], key: SortKey, dir: "asc" | "desc") {
  return [...positions].sort((a, b) => {
    let diff = 0;
    if (key === "openDate") diff = new Date(a.openedAt ?? 0).getTime() - new Date(b.openedAt ?? 0).getTime();
    if (key === "pnlAbs") diff = a.totalPnl - b.totalPnl;
    if (key === "pnlPct") diff = a.totalPnlPercent - b.totalPnlPercent;
    if (key === "dte") diff = a.dte - b.dte;
    if (key === "symbol") diff = a.underlying.localeCompare(b.underlying);
    if (key === "theta") diff = a.greeks.theta - b.greeks.theta;
    return dir === "asc" ? diff : -diff;
  });
}

function groupPositions(positions: ExtendedPosition[], groupBy: string) {
  if (groupBy === "none") return [{ key: "all", label: "All Positions", positions }];
  const groups = new Map<string, ExtendedPosition[]>();
  for (const position of positions) {
    const key =
      groupBy === "strategy" ? position.strategyType :
      groupBy === "sector" ? position.sector ?? "Unclassified" :
      groupBy === "expiration" ? position.expiration :
      position.underlying;
    groups.set(key, [...(groups.get(key) ?? []), position]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => ({
    key,
    label: key,
    positions: group,
  }));
}

function allocationData(positions: ExtendedPosition[], key: "sector" | "strategyType") {
  const totals = new Map<string, number>();
  for (const position of positions) {
    const label = key === "sector" ? position.sector ?? "Unclassified" : position.strategyType;
    const value = Math.max(1, Math.abs(position.totalPnl) || position.legs.reduce((sum, leg) => sum + leg.openPrice * leg.quantity * 100, 0));
    totals.set(label, (totals.get(label) ?? 0) + value);
  }
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0) || 1;
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({ label, value, pct: Math.round((value / total) * 1000) / 10 }));
}

function SortHeader({
  label, sortKey, active, dir, onClick,
}: {
  label: string; sortKey: SortKey; active: boolean; dir: "asc" | "desc"; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 3, background: "none", border: "none",
        cursor: "pointer", color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
        fontSize: 10.5, fontWeight: active ? 600 : 400, padding: 0, letterSpacing: "0.04em",
      }}
    >
      {label}
      {active && (dir === "asc"
        ? <ChevronUp style={{ width: 10, height: 10 }} />
        : <ChevronDown style={{ width: 10, height: 10 }} />
      )}
    </button>
  );
}

function GreekPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: color ?? "hsl(var(--foreground))" }}>
        {value}
      </span>
    </div>
  );
}

function AlertBadge({ alert }: { alert: PositionAlert }) {
  const color =
    alert.severity === "success" ? "hsl(var(--success))" :
    alert.severity === "danger" ? "hsl(var(--destructive))" :
    "hsl(38 92% 50%)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 6px", borderRadius: 999,
      background: `${color}18`, border: `1px solid ${color}35`, color, fontSize: 9, fontWeight: 700,
      letterSpacing: "0.02em",
    }}>
      <AlertTriangle size={10} />
      {alert.label}
    </span>
  );
}

function renderPnl(position: ExtendedPosition, format: string, scheme: string) {
  const positive = pnlTone(position);
  const color = pnlColor(positive, scheme);
  const amount = `${position.totalPnl >= 0 ? "+" : ""}${formatCurrency(position.totalPnl)}`;
  const pct = `${position.totalPnlPercent >= 0 ? "+" : ""}${position.totalPnlPercent.toFixed(2)}%`;
  return (
    <div>
      {format !== "percent" && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: format === "both" ? 2 : 0 }}>
          {positive
            ? <ArrowUpRight style={{ width: 12, height: 12, color }} />
            : <ArrowDownRight style={{ width: 12, height: 12, color }} />
          }
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", color, fontVariantNumeric: "tabular-nums" }}>
            {amount}
          </span>
        </div>
      )}
      {format !== "amount" && (
        <div style={{ fontSize: 10, color, fontVariantNumeric: "tabular-nums", fontWeight: format === "percent" ? 700 : 500 }}>
          {pct}
        </div>
      )}
    </div>
  );
}

function PositionRow({ position }: { position: ExtendedPosition }) {
  const [expanded, setExpanded] = useState(false);
  const isMobile = useIsMobile();
  const { settings } = useSettings();
  const thetaColor = position.greeks.theta < 0 ? "hsl(var(--destructive))" : "hsl(var(--success))";
  const dteColor = position.dte <= 7 ? "hsl(var(--destructive))" : position.dte <= 21 ? "hsl(30 95% 60%)" : "hsl(var(--foreground))";
  const alerts = position.alerts ?? [];

  return (
    <div style={{
      border: alerts.length > 0 ? "1px solid hsl(38 92% 50% / 0.26)" : "1px solid rgba(255,255,255,0.07)",
      borderRadius: 8,
      background: alerts.length > 0 ? "hsl(38 92% 50% / 0.035)" : "rgba(255,255,255,0.02)",
      overflow: "hidden",
    }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: "100%", textAlign: "left", display: "grid",
          gridTemplateColumns: isMobile ? "1fr 1fr auto" : "2fr 1.4fr 0.8fr 1fr 1.4fr auto",
          alignItems: "center", gap: isMobile ? 10 : 16, padding: isMobile ? "12px 14px" : "14px 18px",
          background: "none", border: "none", cursor: "pointer",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4, flexWrap: "wrap" }}>
            <Link href={`/scanner?symbol=${position.underlying}`} onClick={e => e.stopPropagation()}>
              <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>{position.underlying}</span>
            </Link>
            <span style={{
              fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 3,
              background: "rgba(255,255,255,0.08)", color: "hsl(var(--muted-foreground))",
              letterSpacing: "0.02em",
            }}>
              {position.strategyType}
            </span>
            {alerts.map(alert => <AlertBadge key={alert.type} alert={alert} />)}
          </div>
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
            {position.strikesLabel} · exp {position.expiration}
            {settings.autoCalculateDaysInTrade && position.daysInTrade != null ? ` · ${position.daysInTrade}d in trade` : ""}
          </div>
        </div>

        {renderPnl(position, settings.positionsPnlDisplayFormat, settings.pnlColorScheme)}

        {!isMobile && (
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.03em", color: dteColor, fontVariantNumeric: "tabular-nums" }}>
              {position.dte}
            </div>
            <div style={{ fontSize: 9.5, color: "hsl(var(--muted-foreground))" }}>DTE</div>
          </div>
        )}
        {!isMobile && settings.showPositionThetaDecayPerDay && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", color: thetaColor, fontVariantNumeric: "tabular-nums" }}>
              {position.greeks.theta >= 0 ? "+" : ""}{formatCurrency(position.greeks.theta)}/d
            </div>
            <div style={{ fontSize: 9.5, color: "hsl(var(--muted-foreground))" }}>Theta</div>
          </div>
        )}
        {!isMobile && settings.showPositionsPortfolioGreeksSummary && (
          <div style={{ display: "flex", gap: 16 }}>
            <GreekPill label="DELTA" value={(position.greeks.delta >= 0 ? "+" : "") + position.greeks.delta.toFixed(3)} color={Math.abs(position.greeks.delta) > 0.3 ? "hsl(30 95% 60%)" : undefined} />
            <GreekPill label="VEGA" value={formatCurrency(position.greeks.vega)} />
          </div>
        )}

        <div style={{ color: "hsl(var(--muted-foreground))" }}>
          {expanded ? <ChevronUp style={{ width: 14, height: 14 }} /> : <ChevronDown style={{ width: 14, height: 14 }} />}
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: isMobile ? "10px 14px 12px" : "12px 18px 14px" }}>
          <div style={{ display: "flex", gap: 16, marginBottom: 10, flexWrap: "wrap" }}>
            <GreekPill label="OPENED" value={formatDate(position.openedAt)} />
            {settings.showUnrealizedPnl && <GreekPill label="UNREALIZED" value={formatCurrency(position.unrealizedPnl ?? position.totalPnl)} color={pnlColor((position.unrealizedPnl ?? position.totalPnl) >= 0, settings.pnlColorScheme)} />}
            {settings.showRealizedPnl && <GreekPill label="REALIZED" value={formatCurrency(position.realizedPnl ?? 0)} />}
            {settings.showPnlAsPctOfMaxProfit && <GreekPill label="% MAX PROFIT" value={`${(position.maxProfitPnlPercent ?? position.totalPnlPercent).toFixed(2)}%`} />}
            {isMobile && <GreekPill label="DTE" value={String(position.dte)} color={dteColor} />}
            {isMobile && settings.showPositionThetaDecayPerDay && <GreekPill label="THETA" value={`${position.greeks.theta >= 0 ? "+" : ""}${formatCurrency(position.greeks.theta)}/d`} color={thetaColor} />}
          </div>

          {(settings.showProfitTargetMarker || settings.showStopLossMarker) && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {settings.showProfitTargetMarker && <AlertBadge alert={{ type: "target", label: `Target ${settings.defaultProfitTargetPct}%`, severity: "success" }} />}
              {settings.showStopLossMarker && <AlertBadge alert={{ type: "stop", label: `Stop ${settings.defaultStopLossPct}%`, severity: "danger" }} />}
            </div>
          )}

          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: "hsl(var(--muted-foreground))", marginBottom: 8 }}>
            LEGS
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {position.legs.map((leg, i) => {
              const legPnlColor = pnlColor(leg.pnl >= 0, settings.pnlColorScheme);
              const actionColor = leg.action === "long" ? "hsl(var(--success))" : "hsl(var(--destructive))";
              return (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr 1fr",
                  gap: isMobile ? 8 : 12, padding: "8px 12px", borderRadius: 7,
                  background: "rgba(255,255,255,0.025)", alignItems: "center",
                }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 3,
                      background: `${actionColor}18`, color: actionColor,
                      textTransform: "uppercase", letterSpacing: "0.04em",
                    }}>
                      {leg.action}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: "capitalize" }}>
                      {leg.optionType}
                    </span>
                  </div>
                  <GreekPill label="STRIKE" value={formatCurrency(leg.strikePrice)} />
                  <GreekPill label="ENTRY" value={formatCurrency(leg.openPrice)} />
                  <GreekPill label="CURRENT" value={formatCurrency(leg.livePrice ?? leg.currentPrice)} />
                  <div style={{ textAlign: isMobile ? "left" : "right" }}>
                    <GreekPill label="P&L" value={`${leg.pnl >= 0 ? "+" : ""}${formatCurrency(leg.pnl)}`} color={legPnlColor} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      padding: "13px 16px", borderRadius: 8,
      border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)",
    }}>
      <div style={{ fontSize: 9.5, letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", marginBottom: 7, fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.03em", color: color ?? "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}

function PortfolioSummary({ positions, buyingPowerUsedPct, closedPnl }: { positions: ExtendedPosition[]; buyingPowerUsedPct: number; closedPnl: number }) {
  const isMobile = useIsMobile();
  const { settings } = useSettings();
  const totalPnl = positions.reduce((s, p) => s + p.totalPnl, 0) + (settings.includeClosedPositionsInPnlTotals ? closedPnl : 0);
  const totalTheta = positions.reduce((s, p) => s + p.greeks.theta, 0);
  const totalDelta = positions.reduce((s, p) => s + p.greeks.delta, 0);
  const cards = [
    { label: "TOTAL P&L", value: formatCurrency(totalPnl), color: pnlColor(totalPnl >= 0, settings.pnlColorScheme), show: true },
    { label: "DAILY P&L", value: formatCurrency(positions.reduce((s, p) => s + p.totalPnl, 0)), color: pnlColor(totalPnl >= 0, settings.pnlColorScheme), show: settings.showDailyPnlChange },
    { label: "PORTFOLIO THETA", value: `${formatCurrency(totalTheta)}/d`, color: totalTheta < 0 ? "hsl(var(--destructive))" : "hsl(var(--success))", show: settings.showPositionsPortfolioGreeksSummary },
    { label: "DELTA EXPOSURE", value: (totalDelta >= 0 ? "+" : "") + totalDelta.toFixed(3), color: undefined, show: settings.showPortfolioDeltaExposure },
    { label: "BUYING POWER USED", value: `${buyingPowerUsedPct.toFixed(1)}%`, color: undefined, show: settings.showBuyingPowerUsedPct },
    { label: "OPEN POSITIONS", value: String(positions.length), color: undefined, show: true },
  ].filter(card => card.show);

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 22 }}>
      {cards.map(card => <StatCard key={card.label} {...card} />)}
    </div>
  );
}

function AllocationChart({ title, data }: { title: string; data: Array<{ label: string; pct: number }> }) {
  if (data.length === 0) return null;
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, background: "rgba(255,255,255,0.02)", padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
        <BarChart3 size={14} color="hsl(var(--primary))" />
        {title}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {data.map(item => (
          <div key={item.label} style={{ display: "grid", gridTemplateColumns: "90px 1fr 44px", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</div>
            <div style={{ height: 7, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
              <div style={{ width: `${Math.max(3, item.pct)}%`, height: "100%", background: "hsl(var(--primary))" }} />
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{item.pct.toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PositionGroup({ label, positions }: { label: string; positions: ExtendedPosition[] }) {
  const { settings } = useSettings();
  const [collapsed, setCollapsed] = useState(settings.collapsePositionGroupsByDefault);
  const totalPnl = positions.reduce((sum, position) => sum + position.totalPnl, 0);
  const totalDelta = positions.reduce((sum, position) => sum + position.greeks.delta, 0);
  const totalTheta = positions.reduce((sum, position) => sum + position.greeks.theta, 0);

  useEffect(() => {
    setCollapsed(settings.collapsePositionGroupsByDefault);
  }, [settings.collapsePositionGroupsByDefault]);

  return (
    <section style={{ display: "grid", gap: 10 }}>
      {settings.positionsGroupBy !== "none" && (
        <button
          onClick={() => setCollapsed(value => !value)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 8, padding: "10px 12px", color: "hsl(var(--foreground))", cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            <span style={{ fontSize: 12, fontWeight: 750 }}>{label}</span>
            <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>{positions.length} positions</span>
          </div>
          {settings.showPositionGroupSubtotals && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, fontWeight: 700 }}>
              <span style={{ color: pnlColor(totalPnl >= 0, settings.pnlColorScheme) }}>{formatCurrency(totalPnl)}</span>
              {settings.showPortfolioGreeksPerGroup && <span>Δ {(totalDelta >= 0 ? "+" : "") + totalDelta.toFixed(2)}</span>}
              {settings.showPortfolioGreeksPerGroup && <span>Θ {formatCurrency(totalTheta)}/d</span>}
            </div>
          )}
        </button>
      )}

      {!collapsed && positions.map(pos => <PositionRow key={pos.id} position={pos} />)}
    </section>
  );
}

function ClosedPositions({ stats }: { stats?: PositionStats }) {
  const { settings } = useSettings();
  if (!settings.showClosedPositions || !stats) return null;
  return (
    <div style={{ marginTop: 24, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{settings.showClosedPositionsSeparateSection ? "Closed Positions" : "Recent Closed Activity"}</div>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>{settings.closedPositionHistoryDays} days · {stats.period}</div>
        </div>
        {settings.showWinRateStatistics && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <AlertBadge alert={{ type: "win", label: `${stats.winRate.toFixed(1)}% win rate`, severity: "success" }} />
            <AlertBadge alert={{ type: "closed", label: `${stats.totalClosed} closed`, severity: "warning" }} />
          </div>
        )}
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {stats.closedPositions.slice(0, 8).map(position => (
          <div key={position.id} style={{
            display: "grid", gridTemplateColumns: "90px 1fr 110px", gap: 10, alignItems: "center",
            padding: "8px 10px", borderRadius: 7, background: "rgba(255,255,255,0.025)", fontSize: 11,
          }}>
            <div style={{ fontWeight: 700 }}>{position.symbol || "N/A"}</div>
            <div style={{ color: "hsl(var(--muted-foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{position.description}</div>
            <div style={{ textAlign: "right", color: pnlColor(position.pnl >= 0, settings.pnlColorScheme), fontWeight: 700 }}>{formatCurrency(position.pnl)}</div>
          </div>
        ))}
        {stats.closedPositions.length === 0 && (
          <div style={{ padding: "14px", borderRadius: 8, background: "rgba(255,255,255,0.025)", color: "hsl(var(--muted-foreground))", fontSize: 12 }}>
            No closed positions found for this period.
          </div>
        )}
      </div>
    </div>
  );
}

export default function PositionsPage() {
  const isMobile = useIsMobile();
  const { settings } = useSettings();
  const [sortKey, setSortKey] = useState<SortKey>("dte");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    const nextSort = settings.positionsDefaultSort === "pnlAbs" || settings.positionsDefaultSort === "pnlPct" || settings.positionsDefaultSort === "dte" || settings.positionsDefaultSort === "symbol" || settings.positionsDefaultSort === "openDate"
      ? settings.positionsDefaultSort
      : "dte";
    setSortKey(nextSort);
    setSortDir(nextSort === "pnlAbs" || nextSort === "pnlPct" ? "desc" : "asc");
  }, [settings.positionsDefaultSort]);

  const refetchInterval = syncIntervalMs(settings.tastytradePositionSyncInterval, settings.autoSyncTastytradePositions);
  const { data, isLoading, error } = useGetAccountPositions({
    query: {
      staleTime: typeof refetchInterval === "number" ? refetchInterval : 15_000,
      refetchInterval,
    },
  });
  const { data: balances } = useGetAccountBalances({ query: { enabled: settings.showBuyingPowerUsedPct } });
  const { data: stats } = useQuery<PositionStats>({
    queryKey: ["position-stats", settings.winRateCalculationPeriod, settings.closedPositionHistoryDays],
    queryFn: async () => {
      const res = await fetch("/api/account/position-stats");
      if (!res.ok) throw new Error("Failed to load position stats");
      return res.json();
    },
    enabled: settings.showClosedPositions || settings.showWinRateStatistics,
    staleTime: 60 * 1000,
    refetchInterval: settings.autoSyncTastytradePositions ? 60 * 1000 : false,
  });
  const { data: authStatus } = useQuery<{ enabled: boolean; connected: boolean; oauthReady: boolean }>({
    queryKey: ["tt-auth-status"],
    queryFn: async () => {
      const res = await fetch("/api/auth/status");
      if (!res.ok) throw new Error("Failed to load Tastytrade auth status");
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  const positions = (data?.positions ?? []) as ExtendedPosition[];
  const buyingPowerUsedPct =
    typeof (data as any)?.buyingPowerUsedPct === "number"
      ? (data as any).buyingPowerUsedPct
      : balances && balances.netLiquidatingValue > 0
        ? ((balances.netLiquidatingValue - balances.optionBuyingPower) / balances.netLiquidatingValue) * 100
        : 0;

  const sorted = useMemo(() => sortPositions(positions, sortKey, sortDir), [positions, sortKey, sortDir]);
  const grouped = useMemo(() => groupPositions(sorted, settings.positionsGroupBy), [sorted, settings.positionsGroupBy]);
  const sectorAllocation = useMemo(() => allocationData(positions, "sector"), [positions]);
  const strategyAllocation = useMemo(() => allocationData(positions, "strategyType"), [positions]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "pnlAbs" || key === "pnlPct" ? "desc" : "asc");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "hsl(0 0% 4%)" }}>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ padding: isMobile ? "16px 12px 80px" : "28px 24px 60px" }}>
          <div style={{ marginBottom: isMobile ? 16 : 24 }}>
            <h1 style={{ fontSize: isMobile ? 18 : 24, fontWeight: 700, letterSpacing: "-0.03em", display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
              <Briefcase style={{ width: 20, height: 20, color: "hsl(var(--primary))" }} />
              Positions
            </h1>
            <p style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>
              Live options positions from your Tastytrade account · grouped by {GROUP_LABELS[settings.positionsGroupBy] ?? "Underlying"}
            </p>
          </div>

          {isLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[...Array(3)].map((_, i) => (
                <div key={i} style={{ height: 80, borderRadius: 8, background: "rgba(255,255,255,0.04)", animation: "pulse 1.4s infinite" }} />
              ))}
            </div>
          )}

          {!isLoading && error && (
            <div style={{ padding: "32px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
              {(error as any)?.status === 401
                ? "Tastytrade is not connected yet. Connect your account to load live positions."
                : (error as any)?.status === 503
                  ? authStatus?.oauthReady
                    ? "Tastytrade is ready to connect, but no account is linked yet."
                    : "Tastytrade OAuth credentials are not configured on the server."
                  : `Failed to load positions: ${(error as Error).message}`
              }
            </div>
          )}

          {!isLoading && !error && positions.length === 0 && (
            <div style={{ padding: "60px 24px", textAlign: "center" }}>
              <Briefcase style={{ width: 32, height: 32, opacity: 0.15, margin: "0 auto 12px" }} />
              <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))" }}>No open option positions found.</p>
            </div>
          )}

          {!isLoading && !error && positions.length > 0 && (
            <>
              <PortfolioSummary positions={positions} buyingPowerUsedPct={buyingPowerUsedPct} closedPnl={stats?.totalPnl ?? 0} />

              {(settings.showSectorAllocationChart || settings.showStrategyAllocationChart || settings.showWinRateStatistics) && (
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginBottom: 18 }}>
                  {settings.showSectorAllocationChart && <AllocationChart title="Sector Allocation" data={sectorAllocation} />}
                  {settings.showStrategyAllocationChart && <AllocationChart title="Strategy Allocation" data={strategyAllocation} />}
                  {settings.showWinRateStatistics && (
                    <div style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, background: "rgba(255,255,255,0.02)", padding: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
                        <Target size={14} color="hsl(var(--primary))" />
                        Win Rate
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <StatCard label="WIN RATE" value={`${(stats?.winRate ?? 0).toFixed(1)}%`} />
                        <StatCard label="CLOSED" value={String(stats?.totalClosed ?? 0)} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, padding: "0 4px", flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", letterSpacing: "0.04em" }}>SORT BY</span>
                <SortHeader label="OPENED" sortKey="openDate" active={sortKey === "openDate"} dir={sortDir} onClick={() => handleSort("openDate")} />
                <SortHeader label="DTE" sortKey="dte" active={sortKey === "dte"} dir={sortDir} onClick={() => handleSort("dte")} />
                <SortHeader label="P&L $" sortKey="pnlAbs" active={sortKey === "pnlAbs"} dir={sortDir} onClick={() => handleSort("pnlAbs")} />
                <SortHeader label="P&L %" sortKey="pnlPct" active={sortKey === "pnlPct"} dir={sortDir} onClick={() => handleSort("pnlPct")} />
                <SortHeader label="THETA" sortKey="theta" active={sortKey === "theta"} dir={sortDir} onClick={() => handleSort("theta")} />
                <SortHeader label="SYMBOL" sortKey="symbol" active={sortKey === "symbol"} dir={sortDir} onClick={() => handleSort("symbol")} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {grouped.map(group => (
                  <PositionGroup key={group.key} label={group.label} positions={group.positions} />
                ))}
              </div>

              <ClosedPositions stats={stats} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
