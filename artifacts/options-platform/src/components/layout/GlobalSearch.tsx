import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Search } from "lucide-react";

interface ScreenerRow {
  symbol: string;
  name: string;
  price: number;
  opportunityScore: number;
  recommendedOutlook?: string;
  isETF?: boolean;
  etfCategory?: string;
}

interface Result {
  symbol: string;
  name: string;
  price: number;
  score: number;
  outlook?: string;
  isETF?: boolean;
  etfCategory?: string;
}

const ETF_LABEL: Record<string, string> = {
  "leveraged-bull":   "3× Bull",
  "leveraged-bear":   "3× Bear",
  "leveraged-single": "Single-Stock",
  "sector":           "Sector",
};
const ETF_COLOR: Record<string, string> = {
  "leveraged-bull":   "#4ade80",
  "leveraged-bear":   "#f87171",
  "leveraged-single": "#c084fc",
  "sector":           "hsl(var(--primary))",
};

function rankTier(symbol: string, upper: string): number {
  if (symbol === upper) return 0;
  if (symbol.startsWith(upper)) return 1;
  if (symbol.includes(upper)) return 2;
  return 3;
}

export function GlobalSearch() {
  const [query, setQuery]           = useState("");
  const [results, setResults]       = useState<Result[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen]             = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();

  // Always subscribe to the screener dataset — shares cache with the Screener
  // page (queryKey "screener-v3") and fetches it independently if not yet loaded.
  const { data: screenerData = [] } = useQuery<ScreenerRow[]>({
    queryKey: ["screener-v3"],
    queryFn: () => fetch("/api/screener").then((r) => r.json()),
    staleTime: 3 * 60 * 1000,
    gcTime:   10 * 60 * 1000,
  });

  const search = useCallback(
    (q: string) => {
      const upper = q.toUpperCase().trim();
      if (!upper) {
        setResults([]);
        setOpen(false);
        return;
      }

      if (screenerData.length > 0) {
        const matched = screenerData
          .filter(
            (r) =>
              r.symbol.includes(upper) ||
              r.name.toUpperCase().includes(upper)
          )
          .sort((a, b) => {
            const ta = rankTier(a.symbol, upper);
            const tb = rankTier(b.symbol, upper);
            if (ta !== tb) return ta - tb;
            return b.opportunityScore - a.opportunityScore;
          })
          .slice(0, 10)
          .map((r) => ({
            symbol:      r.symbol,
            name:        r.name,
            price:       r.price,
            score:       r.opportunityScore,
            outlook:     r.recommendedOutlook,
            isETF:       r.isETF,
            etfCategory: r.etfCategory,
          }));
        setResults(matched);
        setOpen(matched.length > 0);
      } else {
        // Screener not loaded yet — fall back to single-ticker lookup
        fetch(`/api/stocks/${encodeURIComponent(upper)}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.symbol) {
              setResults([{
                symbol: data.symbol, name: data.name, price: data.price,
                score: data.opportunityScore ?? 0,
                isETF: data.isETF, etfCategory: data.etfCategory,
              }]);
              setOpen(true);
            }
          })
          .catch(() => {});
      }
    },
    [screenerData]
  );

  useEffect(() => {
    const id = setTimeout(() => search(query), 120);
    return () => clearTimeout(id);
  }, [query, search]);

  const select = useCallback(
    (symbol: string) => {
      setQuery("");
      setOpen(false);
      setActiveIndex(-1);
      setLocation(`/scanner?symbol=${symbol}`);
    },
    [setLocation]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const target = activeIndex >= 0 ? results[activeIndex] : results[0];
      if (target) select(target.symbol);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
    }
  };

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!inputRef.current?.closest("[data-global-search]")?.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const outlookColor = (o?: string) =>
    o === "bullish" ? "#4ade80" : o === "bearish" ? "#f87171" : "hsl(var(--muted-foreground))";

  return (
    <div data-global-search style={{ position: "relative", width: "clamp(280px, 22vw, 380px)" }}>
      {/* Input */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px",
        borderRadius: 7, background: "rgba(255,255,255,0.05)",
        border: `1px solid ${open ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)"}`,
        transition: "border-color 0.15s",
      }}>
        <Search style={{ width: 12, height: 12, color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIndex(-1); }}
          onKeyDown={onKeyDown}
          onFocus={() => { if (query) setOpen(results.length > 0); }}
          placeholder="Search ticker…"
          style={{
            background: "transparent", border: "none", outline: "none",
            color: "hsl(var(--foreground))", fontSize: 12, width: "100%",
            letterSpacing: "-0.01em",
          }}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="characters"
        />
      </div>

      {/* Dropdown — wider than input so full company names show */}
      {open && results.length > 0 && (
        <div
          ref={listRef}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,               // anchor to right edge of input
            width: 360,             // wide enough for long ETF names
            background: "hsl(var(--card))",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            zIndex: 999,
            maxHeight: 380,
            overflowY: "auto",
            padding: "4px 0",
          }}
        >
          {results.map((r, i) => (
            <div
              key={r.symbol}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => { e.preventDefault(); select(r.symbol); }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "7px 12px", cursor: "pointer",
                background: i === activeIndex ? "rgba(255,255,255,0.07)" : "transparent",
                transition: "background 0.08s",
                gap: 8,
              }}
            >
              {/* Left: symbol + badge + name */}
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600, letterSpacing: "-0.01em",
                    color: "hsl(var(--foreground))", flexShrink: 0,
                  }}>
                    {r.symbol}
                  </span>
                  {r.etfCategory ? (
                    <span style={{
                      fontSize: 9, fontWeight: 600, padding: "1.5px 4px", borderRadius: 3, flexShrink: 0,
                      color: ETF_COLOR[r.etfCategory] ?? "hsl(var(--primary))",
                      background: `color-mix(in srgb, ${ETF_COLOR[r.etfCategory] ?? "hsl(var(--primary))"} 15%, transparent)`,
                    }}>
                      {ETF_LABEL[r.etfCategory] ?? "ETF"}
                    </span>
                  ) : r.outlook ? (
                    <span style={{
                      fontSize: 10, color: outlookColor(r.outlook),
                      textTransform: "capitalize", opacity: 0.8, flexShrink: 0,
                    }}>
                      {r.outlook}
                    </span>
                  ) : null}
                </div>
                <span style={{
                  fontSize: 11, color: "hsl(var(--muted-foreground))",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {r.name}
                </span>
              </div>

              {/* Right: price + score */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums" }}>
                  ${r.price.toFixed(2)}
                </span>
                {r.score > 0 && (
                  <span style={{
                    fontSize: 10, fontVariantNumeric: "tabular-nums",
                    color: r.score >= 75 ? "#4ade80" : r.score >= 50 ? "#facc15" : "hsl(var(--muted-foreground))",
                  }}>
                    {r.score}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
