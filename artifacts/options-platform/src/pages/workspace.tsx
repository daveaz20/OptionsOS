import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { StockListPanel } from "@/components/workspace/StockListPanel";
import { StockDetailPanel } from "@/components/workspace/StockDetailPanel";
import { StrategyPanel } from "@/components/workspace/StrategyPanel";
import { useGetStock } from "@workspace/api-client-react";

export default function ScannerPage() {
  const [location] = useLocation();
  const initialSymbol = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("symbol") || "AAPL";
    } catch { return "AAPL"; }
  })();

  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialSymbol);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const sym = params.get("symbol");
      if (sym) setSelectedSymbol(sym);
    } catch { /* ignore */ }
  }, [location]);

  const { data: stock } = useGetStock(selectedSymbol, { query: { enabled: !!selectedSymbol } });

  return (
    <div className="h-full w-full flex flex-col bg-background">
      <ResizablePanelGroup direction="horizontal" className="h-full w-full rounded-none">
        <ResizablePanel defaultSize={20} minSize={15} maxSize={30} className="h-full">
          <StockListPanel
            selectedSymbol={selectedSymbol}
            onSelect={setSelectedSymbol}
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
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
