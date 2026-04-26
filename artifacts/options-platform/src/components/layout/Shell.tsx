import { Link, useLocation, useSearch } from "wouter";
import { Activity, LayoutDashboard, Filter, LineChart, Briefcase, Bookmark, Settings } from "lucide-react";
import { GlobalSearch } from "./GlobalSearch";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSettings } from "@/contexts/SettingsContext";
import { useMarketOpen } from "@/hooks/use-market-open";
import {
  useGetTastytradeAuthStatus,
  useGetTastytradeStreamerStatus,
} from "@workspace/api-client-react";

interface ShellProps {
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: "/",          label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { href: "/scans",     label: "Scans",     icon: <Filter size={18} /> },
  { href: "/analysis",  label: "Analysis",  icon: <LineChart size={18} /> },
  { href: "/watchlist", label: "Watchlist", icon: <Bookmark size={18} /> },
  { href: "/positions", label: "Positions", icon: <Briefcase size={18} /> },
];

export function Shell({ children }: ShellProps) {
  const [location] = useLocation();
  const search     = useSearch();
  const marketOpen = useMarketOpen();
  const isMobile   = useIsMobile();
  const { settings, sensitiveDataHidden } = useSettings();
  const { data: authStatus } = useGetTastytradeAuthStatus();
  const { data: streamerStatus } = useGetTastytradeStreamerStatus({
    query: { enabled: Boolean(authStatus?.enabled && authStatus?.connected) },
  });

  const statusColor = marketOpen ? "hsl(var(--success))" : "hsl(var(--muted-foreground))";
  const showTastytradeBadge = Boolean(authStatus?.enabled && authStatus?.connected);
  const streamerLive = Boolean(showTastytradeBadge && streamerStatus?.connected);
  const ttTone = streamerLive ? "hsl(var(--success))" : "hsl(43 96% 56%)";
  const ttBorder = streamerLive ? "hsl(var(--success)/0.22)" : "hsl(43 96% 56% / 0.24)";
  const ttBg = streamerLive ? "hsl(var(--success)/0.1)" : "hsl(43 96% 56% / 0.12)";

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground font-sans">
      {sensitiveDataHidden && settings.showSensitiveDataHiddenBanner && (
        <div style={{ height: 28, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "rgba(239,68,68,0.16)", borderBottom: "1px solid rgba(239,68,68,0.28)", color: "hsl(var(--destructive))", fontSize: 12, fontWeight: 700 }}>
          Sensitive Data Hidden
        </div>
      )}
      <header
        style={{
          display: "flex",
          height: 58,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(20px)",
          zIndex: 50,
        }}
      >
        {/* Left: logo + desktop nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: "hsl(var(--foreground))" }}>
            <Activity style={{ width: 18, height: 18, color: "hsl(var(--primary))" }} />
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.03em" }}>OptionsOS</span>
          </Link>

          {!isMobile && (
            <nav style={{ display: "flex", gap: 2 }}>
              {NAV_ITEMS.map((item) => {
                const itemPath = item.href.split("?")[0]!;
                const active = location === itemPath && !search.includes("tab=watchlist");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{
                      padding: "5px 13px",
                      borderRadius: 6,
                      fontSize: 14,
                      fontWeight: active ? 500 : 400,
                      color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                      background: active ? "rgba(255,255,255,0.07)" : "transparent",
                      textDecoration: "none",
                      transition: "all 0.12s",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>

        {/* Center: global search (desktop only) */}
        {!isMobile && <GlobalSearch />}

        {/* Right */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {showTastytradeBadge && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: isMobile ? "5px 8px" : "6px 10px",
                borderRadius: 999,
                border: `1px solid ${ttBorder}`,
                background: ttBg,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--foreground))", letterSpacing: "0.02em" }}>
                TT
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: ttTone, letterSpacing: "0.04em" }}>
                {streamerLive ? "LIVE" : "REST"}
              </span>
            </div>
          )}
          {/* Market status dot — always visible */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ position: "relative", display: "flex", width: 6, height: 6 }}>
              {marketOpen && (
                <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: statusColor, opacity: 0.5, animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite" }} />
              )}
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, position: "relative" }} />
            </span>
            {!isMobile && (
              <span style={{ fontSize: 12, fontWeight: 500, color: statusColor }}>
                {marketOpen ? "Market Open" : "Market Closed"}
              </span>
            )}
          </div>

          {!isMobile && (
            <>
              <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.08)" }} />
              <Link href="/settings" style={{ display: "flex", padding: 5, borderRadius: 6, color: location === "/settings" ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))", background: location === "/settings" ? "rgba(255,255,255,0.07)" : "transparent", transition: "all 0.12s" }}>
                <Settings style={{ width: 14, height: 14 }} />
              </Link>
            </>
          )}
        </div>
      </header>

      {/* Main content — add bottom padding on mobile for the tab bar */}
      <main
        className="flex-1 overflow-hidden flex flex-col relative z-0"
        style={{ paddingBottom: isMobile ? 60 : 0 }}
      >
        {children}
      </main>

      {/* Mobile bottom tab bar */}
      {isMobile && (
        <nav
          style={{
            position: "fixed", bottom: 0, left: 0, right: 0, height: 60,
            display: "flex", alignItems: "stretch",
            background: "rgba(0,0,0,0.9)",
            backdropFilter: "blur(20px)",
            borderTop: "1px solid rgba(255,255,255,0.07)",
            zIndex: 50,
          }}
        >
          {NAV_ITEMS.map((item) => {
            const itemPath2 = item.href.split("?")[0]!;
            const active = location === itemPath2;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  flex: 1, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  gap: 3, textDecoration: "none", padding: "6px 0",
                  color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                  fontSize: 10, fontWeight: active ? 600 : 400,
                  borderTop: active ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                  transition: "color 0.12s",
                }}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
