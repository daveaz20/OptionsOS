import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { StockListPanel } from "@/components/workspace/StockListPanel";
import { StockDetailPanel } from "@/components/workspace/StockDetailPanel";
import { StrategyPanel } from "@/components/workspace/StrategyPanel";
import { useGetStock } from "@workspace/api-client-react";
import { useIsMobile } from "@/hooks/use-mobile";

type MobileTab = "list" | "detail" | "strategy";

const MOBILE_TABS: { key: MobileTab; label: string }[] = [
  { key: "list",     label: "Stocks"   },
  { key: "detail",   label: "Analysis" },
  { key: "strategy", label: "Strategy" },
];

export default function ScannerPage() {
  const [location] = useLocation();
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<MobileTab>("detail");

  const initialSymbol = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("symbol") || "AAPL";
    } catch { return "AAPL"; }
  })();

  const initialStockListTab = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("tab") === "watchlist" ? "watchlist" : "ideas";
    } catch { return "ideas"; }
  })() as "ideas" | "watchlist";

  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialSymbol);
  const [stockListTab, setStockListTab] = useState<"ideas" | "watchlist">(initialStockListTab);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const sym = params.get("symbol");
      const tab = params.get("tab");
      if (sym) setSelectedSymbol(sym);
      if (tab === "watchlist") setStockListTab("watchlist");
      else if (!tab) setStockListTab("ideas");
    } catch { /* ignore */ }
  }, [location]);

  const { data: stock } = useGetStock(selectedSymbol, { query: { enabled: !!selectedSymbol } });

  // Mobile: single-panel tab layout
  if (isMobile) {
    return (
      <div className="h-full w-full flex flex-col bg-background">
        {/* Active panel */}
        <div className="flex-1 overflow-hidden">
          {mobileTab === "list" && (
            <StockListPanel
              selectedSymbol={selectedSymbol}
              onSelect={(sym) => { setSelectedSymbol(sym); setMobileTab("detail"); }}
              initialTab={stockListTab}
            />
          )}
          {mobileTab === "detail" && (
            <StockDetailPanel symbol={selectedSymbol} />
          )}
          {mobileTab === "strategy" && (
            <StrategyPanel symbol={selectedSymbol} currentPrice={stock?.price} recommendedOutlook={stock?.recommendedOutlook} />
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

  // Desktop: resizable 3-panel layout
  return (
    <div className="h-full w-full flex flex-col bg-background">
      <ResizablePanelGroup direction="horizontal" className="h-full w-full rounded-none">
        <ResizablePanel defaultSize={20} minSize={15} maxSize={30} className="h-full">
          <StockListPanel
            selectedSymbol={selectedSymbol}
            onSelect={setSelectedSymbol}
            initialTab={stockListTab}
          />
        </ResizablePanel>

        <ResizableHandle className="w-px bg-white/5 hover:bg-primary/50 transition-colors cursor-col-resize" />

        <ResizablePanel defaultSize={50} minSize={40} className="h-full">
          <StockDetailPanel symbol={selectedSymbol} />
        </ResizablePanel>

        <ResizableHandle className="w-px bg-white/5 hover:bg-primary/50 transition-colors cursor-col-resize" />

        <ResizablePanel defaultSize={30} minSize={25} maxSize={40} className="h-full">
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
