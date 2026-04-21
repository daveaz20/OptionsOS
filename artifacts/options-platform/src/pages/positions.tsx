import { useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useGetAccountPositions } from "@workspace/api-client-react";
import type { AccountPosition } from "@workspace/api-client-react";
import { formatCurrency, formatPercent } from "@/lib/format";
import { ArrowDownRight, ArrowUpRight, Briefcase, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "wouter";

type SortKey = "dte" | "pnl" | "theta";

function sortPositions(positions: AccountPosition[], key: SortKey, dir: "asc" | "desc") {
  return [...positions].sort((a, b) => {
    let diff = 0;
    if (key === "dte")   diff = a.dte - b.dte;
    if (key === "pnl")   diff = a.totalPnl - b.totalPnl;
    if (key === "theta") diff = a.greeks.theta - b.greeks.theta;
    return dir === "asc" ? diff : -diff;
  });
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

function PositionRow({ position }: { position: AccountPosition }) {
  const [expanded, setExpanded] = useState(false);
  const isMobile = useIsMobile();
  const isUp = position.totalPnl >= 0;
  const thetaColor = position.greeks.theta < 0 ? "hsl(var(--destructive))" : "hsl(var(--success))";
  const dteColor = position.dte <= 7 ? "hsl(var(--destructive))" : position.dte <= 21 ? "hsl(30 95% 60%)" : "hsl(var(--foreground))";

  return (
    <div style={{
      border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10,
      background: "rgba(255,255,255,0.02)", overflow: "hidden",
    }}>
      {/* Main row */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: "100%", textAlign: "left", display: "grid",
          gridTemplateColumns: isMobile ? "1fr 1fr auto" : "2fr 1.5fr 1fr 1fr 1.5fr auto",
          alignItems: "center", gap: isMobile ? 10 : 16, padding: isMobile ? "12px 14px" : "14px 18px",
          background: "none", border: "none", cursor: "pointer",
          transition: "background 0.1s",
        }}
        onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.025)"}
        onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "transparent"}
      >
        {/* Symbol + strategy */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
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
          </div>
          <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
            {position.strikesLabel} · exp {position.expiration}
          </div>
        </div>

        {/* P&L */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
            {isUp
              ? <ArrowUpRight style={{ width: 12, height: 12, color: "hsl(var(--success))" }} />
              : <ArrowDownRight style={{ width: 12, height: 12, color: "hsl(var(--destructive))" }} />
            }
            <span style={{
              fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em",
              color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))",
              fontVariantNumeric: "tabular-nums",
            }}>
              {formatCurrency(position.totalPnl)}
            </span>
          </div>
          <div style={{ fontSize: 10, color: isUp ? "hsl(var(--success))" : "hsl(var(--destructive))", fontVariantNumeric: "tabular-nums" }}>
            {position.totalPnlPercent >= 0 ? "+" : ""}{position.totalPnlPercent.toFixed(2)}%
          </div>
        </div>

        {/* DTE / Theta / Greeks — hidden on mobile (shown in expanded section) */}
        {!isMobile && (
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.03em", color: dteColor, fontVariantNumeric: "tabular-nums" }}>
              {position.dte}
            </div>
            <div style={{ fontSize: 9.5, color: "hsl(var(--muted-foreground))" }}>DTE</div>
          </div>
        )}
        {!isMobile && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", color: thetaColor, fontVariantNumeric: "tabular-nums" }}>
              {position.greeks.theta >= 0 ? "+" : ""}{formatCurrency(position.greeks.theta)}/d
            </div>
            <div style={{ fontSize: 9.5, color: "hsl(var(--muted-foreground))" }}>Theta</div>
          </div>
        )}
        {!isMobile && (
          <div style={{ display: "flex", gap: 16 }}>
            <GreekPill
              label="DELTA"
              value={(position.greeks.delta >= 0 ? "+" : "") + position.greeks.delta.toFixed(3)}
              color={Math.abs(position.greeks.delta) > 0.3 ? "hsl(30 95% 60%)" : undefined}
            />
            <GreekPill
              label="VEGA"
              value={formatCurrency(position.greeks.vega)}
            />
          </div>
        )}

        {/* Expand toggle */}
        <div style={{ color: "hsl(var(--muted-foreground))" }}>
          {expanded
            ? <ChevronUp style={{ width: 14, height: 14 }} />
            : <ChevronDown style={{ width: 14, height: 14 }} />
          }
        </div>
      </button>

      {/* Expanded legs */}
      {expanded && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: isMobile ? "10px 14px 12px" : "12px 18px 14px" }}>
          {/* Mobile summary row: DTE / Theta / Greeks */}
          {isMobile && (
            <div style={{ display: "flex", gap: 16, marginBottom: 10, flexWrap: "wrap" }}>
              <GreekPill label="DTE" value={String(position.dte)} color={dteColor} />
              <GreekPill label="THETA" value={`${position.greeks.theta >= 0 ? "+" : ""}${formatCurrency(position.greeks.theta)}/d`} color={thetaColor} />
              <GreekPill label="DELTA" value={(position.greeks.delta >= 0 ? "+" : "") + position.greeks.delta.toFixed(3)} color={Math.abs(position.greeks.delta) > 0.3 ? "hsl(30 95% 60%)" : undefined} />
              <GreekPill label="VEGA" value={formatCurrency(position.greeks.vega)} />
            </div>
          )}
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: "hsl(var(--muted-foreground))", marginBottom: 8 }}>
            LEGS
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {position.legs.map((leg, i) => {
              const legPnlColor = leg.pnl >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))";
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
                  <div>
                    <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>Strike</div>
                    <div style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatCurrency(leg.strikePrice)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>Entry</div>
                    <div style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatCurrency(leg.openPrice)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>Current</div>
                    <div style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatCurrency(leg.currentPrice)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 9, color: "hsl(var(--muted-foreground))" }}>P&L</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: legPnlColor, fontVariantNumeric: "tabular-nums" }}>
                      {leg.pnl >= 0 ? "+" : ""}{formatCurrency(leg.pnl)}
                    </div>
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

// ─── Portfolio summary strip ───────────────────────────────────────────────

function PortfolioSummary({ positions }: { positions: AccountPosition[] }) {
  const isMobile = useIsMobile();
  const totalPnl = positions.reduce((s, p) => s + p.totalPnl, 0);
  const totalTheta = positions.reduce((s, p) => s + p.greeks.theta, 0);
  const totalDelta = positions.reduce((s, p) => s + p.greeks.delta, 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: 10, marginBottom: 22 }}>
      {[
        { label: "TOTAL P&L", value: formatCurrency(totalPnl), color: totalPnl >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))" },
        { label: "PORTFOLIO THETA", value: `${formatCurrency(totalTheta)}/d`, color: totalTheta < 0 ? "hsl(var(--destructive))" : "hsl(var(--success))" },
        { label: "PORTFOLIO DELTA", value: (totalDelta >= 0 ? "+" : "") + totalDelta.toFixed(3), color: undefined },
        { label: "OPEN POSITIONS", value: String(positions.length), color: undefined },
      ].map((m, i) => (
        <div key={i} style={{
          flex: 1, padding: "13px 16px", borderRadius: 9,
          border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)",
        }}>
          <div style={{ fontSize: 9.5, letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", marginBottom: 7, fontWeight: 500 }}>
            {m.label}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.03em", color: m.color ?? "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums" }}>
            {m.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────

export default function PositionsPage() {
  const isMobile = useIsMobile();
  const [sortKey, setSortKey] = useState<SortKey>("dte");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const { data, isLoading, error } = useGetAccountPositions();
  const positions = data?.positions ?? [];

  const sorted = useMemo(
    () => sortPositions(positions, sortKey, sortDir),
    [positions, sortKey, sortDir],
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "pnl" ? "desc" : "asc");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "hsl(0 0% 4%)" }}>
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ padding: isMobile ? "16px 12px 80px" : "28px 24px 60px" }}>

        {/* Header */}
        <div style={{ marginBottom: isMobile ? 16 : 24 }}>
          <h1 style={{ fontSize: isMobile ? 18 : 24, fontWeight: 700, letterSpacing: "-0.03em", display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
            <Briefcase style={{ width: 20, height: 20, color: "hsl(var(--primary))" }} />
            Positions
          </h1>
          <p style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>
            Live options positions from your Tastytrade account
          </p>
        </div>

        {/* Loading */}
        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[...Array(3)].map((_, i) => (
              <div key={i} style={{ height: 80, borderRadius: 10, background: "rgba(255,255,255,0.04)", animation: "pulse 1.4s infinite" }} />
            ))}
          </div>
        )}

        {/* Error */}
        {!isLoading && error && (
          <div style={{ padding: "32px", textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
            {(error as any)?.status === 503
              ? "Tastytrade credentials not configured. Add TASTYTRADE_USERNAME and TASTYTRADE_PASSWORD to your environment."
              : `Failed to load positions: ${(error as Error).message}`
            }
          </div>
        )}

        {/* Empty */}
        {!isLoading && !error && positions.length === 0 && (
          <div style={{ padding: "60px 24px", textAlign: "center" }}>
            <Briefcase style={{ width: 32, height: 32, opacity: 0.15, margin: "0 auto 12px" }} />
            <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))" }}>No open option positions found.</p>
          </div>
        )}

        {/* Positions */}
        {!isLoading && !error && positions.length > 0 && (
          <>
            <PortfolioSummary positions={positions} />

            {/* Sort controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, padding: "0 4px" }}>
              <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", letterSpacing: "0.04em" }}>SORT BY</span>
              <SortHeader label="DTE"   sortKey="dte"   active={sortKey === "dte"}   dir={sortDir} onClick={() => handleSort("dte")} />
              <SortHeader label="P&L"   sortKey="pnl"   active={sortKey === "pnl"}   dir={sortDir} onClick={() => handleSort("pnl")} />
              <SortHeader label="THETA" sortKey="theta" active={sortKey === "theta"} dir={sortDir} onClick={() => handleSort("theta")} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {sorted.map(pos => (
                <PositionRow key={pos.id} position={pos} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
    </div>
  );
}
