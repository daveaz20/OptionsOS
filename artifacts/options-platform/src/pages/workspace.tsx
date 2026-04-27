import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { StockDetailPanel } from "@/components/workspace/StockDetailPanel";
import { StrategyPanel } from "@/components/workspace/StrategyPanel";
import { useGetStock } from "@workspace/api-client-react";
import { useIsMobile } from "@/hooks/use-mobile";

type MobileTab = "detail" | "strategy";

const MOBILE_TABS: { key: MobileTab; label: string }[] = [
  { key: "detail",   label: "Analysis" },
  { key: "strategy", label: "Strategy" },
];

const LAST_ANALYSIS_SYMBOL_KEY = "optionsos:last-analysis-symbol";
const DEFAULT_SYMBOL = "AAPL";

function normalizeSymbol(symbol: string | null | undefined) {
  return (symbol ?? "").trim().toUpperCase();
}

function getStoredAnalysisSymbol() {
  try {
    return normalizeSymbol(window.localStorage.getItem(LAST_ANALYSIS_SYMBOL_KEY)) || DEFAULT_SYMBOL;
  } catch {
    return DEFAULT_SYMBOL;
  }
}

function getInitialAnalysisSymbol() {
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeSymbol(params.get("symbol")) || getStoredAnalysisSymbol();
  } catch {
    return DEFAULT_SYMBOL;
  }
}

export default function ScannerPage() {
  const [location] = useLocation();
  const search     = useSearch();
  const isMobile   = useIsMobile();
  const [mobileTab, setMobileTab] = useState<MobileTab>("detail");

  const [selectedSymbol, setSelectedSymbol] = useState<string>(getInitialAnalysisSymbol);

  // Reactive to both path and search changes (handles same-path navigation with different ?tab=)
  useEffect(() => {
    try {
      const params = new URLSearchParams(search || window.location.search);
      const sym = normalizeSymbol(params.get("symbol"));
      if (sym && sym !== selectedSymbol) { setSelectedSymbol(sym); }
    } catch { /* ignore */ }
  }, [location, search]);

  useEffect(() => {
    if (!selectedSymbol) return;
    try {
      window.localStorage.setItem(LAST_ANALYSIS_SYMBOL_KEY, selectedSymbol);
    } catch { /* ignore */ }
  }, [selectedSymbol]);

  const { data: stock } = useGetStock(selectedSymbol, { query: { enabled: !!selectedSymbol } });

  // Mobile: single-panel tab layout
  if (isMobile) {
    return (
      <div className="h-full w-full flex flex-col bg-background">
        {/* Active panel */}
        <div className="flex-1 overflow-hidden">
          {mobileTab === "detail" && (
            <StockDetailPanel symbol={selectedSymbol} />
          )}
          {mobileTab === "strategy" && (
            <StrategyPanel
              symbol={selectedSymbol}
              currentPrice={stock?.price}
              recommendedOutlook={stock?.recommendedOutlook}
            />
          )}
        </div>

        {/* Tab bar */}
        <div style={{
          display: "flex", flexShrink: 0,
          borderTop: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(10px)",
        }}>
          {MOBILE_TABS.map((tab) => {
            const active = mobileTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setMobileTab(tab.key)}
                style={{
                  flex: 1, padding: "10px 0", border: "none", background: "transparent",
                  color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                  fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer",
                  borderTop: active ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                  transition: "color 0.12s",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Desktop: focused 2-panel analysis layout. Discovery now lives in Scans.
  return (
    <div className="h-full w-full flex flex-col bg-background">
      <ResizablePanelGroup direction="horizontal" className="h-full w-full rounded-none">
        <ResizablePanel defaultSize={64} minSize={48} className="h-full">
          <StockDetailPanel symbol={selectedSymbol} />
        </ResizablePanel>

        <ResizableHandle className="w-px bg-white/5 hover:bg-primary/50 transition-colors cursor-col-resize" />

        <ResizablePanel defaultSize={36} minSize={28} maxSize={48} className="h-full">
          <StrategyPanel
            symbol={selectedSymbol}
            currentPrice={stock?.price}
            recommendedOutlook={stock?.recommendedOutlook}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
