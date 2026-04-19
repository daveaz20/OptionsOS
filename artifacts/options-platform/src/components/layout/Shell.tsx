import { Link, useLocation } from "wouter";
import { Activity, LayoutDashboard, Filter, LineChart, Briefcase, Settings } from "lucide-react";
import { useState, useEffect } from "react";
import { GlobalSearch } from "./GlobalSearch";
import { useIsMobile } from "@/hooks/use-mobile";

interface ShellProps {
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: "/",          label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { href: "/screener",  label: "Screener",  icon: <Filter size={18} /> },
  { href: "/scanner",   label: "Analysis",  icon: <LineChart size={18} /> },
  { href: "/positions", label: "Positions", icon: <Briefcase size={18} /> },
];

function useMarketOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function check() {
      try {
        const etStr = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
        const et = new Date(etStr);
        const day = et.getDay();
        if (day === 0 || day === 6) { setOpen(false); return; }
        const totalMin = et.getHours() * 60 + et.getMinutes();
        setOpen(totalMin >= 9 * 60 + 30 && totalMin < 16 * 60);
      } catch {
        setOpen(false);
      }
    }
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);

  return open;
}

export function Shell({ children }: ShellProps) {
  const [location] = useLocation();
  const marketOpen = useMarketOpen();
  const isMobile = useIsMobile();

  const statusColor = marketOpen ? "hsl(var(--success))" : "hsl(var(--muted-foreground))";

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground font-sans">
      <header
        style={{
          display: "flex",
          height: 48,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(20px)",
          zIndex: 50,
        }}
      >
        {/* Left: logo + desktop nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 7, textDecoration: "none", color: "hsl(var(--foreground))" }}>
            <Activity style={{ width: 16, height: 16, color: "hsl(var(--primary))" }} />
            <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em" }}>OptionsPlay</span>
          </Link>

          {!isMobile && (
            <nav style={{ display: "flex", gap: 2 }}>
              {NAV_ITEMS.map((item) => {
                const active = location === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{
                      padding: "4px 12px",
                      borderRadius: 6,
                      fontSize: 13,
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
          {/* Market status dot — always visible */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ position: "relative", display: "flex", width: 6, height: 6 }}>
              {marketOpen && (
                <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: statusColor, opacity: 0.5, animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite" }} />
              )}
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, position: "relative" }} />
            </span>
            {!isMobile && (
              <span style={{ fontSize: 11, fontWeight: 500, color: statusColor }}>
                {marketOpen ? "Market Open" : "Market Closed"}
              </span>
            )}
          </div>

          {!isMobile && (
            <>
              <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.08)" }} />
              <button style={{ display: "flex", padding: 5, borderRadius: 6, border: "none", background: "transparent", color: "hsl(var(--muted-foreground))", cursor: "pointer" }}>
                <Settings style={{ width: 14, height: 14 }} />
              </button>
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
            const active = location === item.href;
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
