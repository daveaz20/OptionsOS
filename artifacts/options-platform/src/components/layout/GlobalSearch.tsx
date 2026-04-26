import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Search } from "lucide-react";

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
  "leveraged-bull": "3x Bull",
  "leveraged-bear": "3x Bear",
  "leveraged-single": "Single-Stock",
  sector: "Sector",
};

const ETF_COLOR: Record<string, string> = {
  "leveraged-bull": "#4ade80",
  "leveraged-bear": "#f87171",
  "leveraged-single": "#c084fc",
  sector: "hsl(var(--primary))",
};

function rankTier(symbol: string, upper: string): number {
  if (symbol === upper) return 0;
  if (symbol.startsWith(upper)) return 1;
  if (symbol.includes(upper)) return 2;
  return 3;
}

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [query]);

  const trimmedQuery = debouncedQuery.trim();
  const upperQuery = trimmedQuery.toUpperCase();
  const shouldSearch = upperQuery.length > 0;

  const { data: results = [] } = useQuery<Result[]>({
    queryKey: ["global-search", upperQuery],
    enabled: shouldSearch,
    queryFn: async () => {
      const response = await fetch(`/api/stocks/search?q=${encodeURIComponent(trimmedQuery)}&limit=10`);
      if (!response.ok) {
        throw new Error("Failed to search symbols");
      }
      return response.json();
    },
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const rankedResults = useMemo(() => {
    return [...results].sort((a, b) => {
      const tierA = rankTier(a.symbol, upperQuery);
      const tierB = rankTier(b.symbol, upperQuery);
      if (tierA !== tierB) return tierA - tierB;
      return b.score - a.score;
    });
  }, [results, upperQuery]);

  useEffect(() => {
    if (!shouldSearch) {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    setOpen(rankedResults.length > 0);
  }, [rankedResults.length, shouldSearch]);

  const select = useCallback(
    (symbol: string) => {
      setQuery("");
      setOpen(false);
      setActiveIndex(-1);
      setLocation(`/analysis?symbol=${symbol}`);
    },
    [setLocation]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, rankedResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const target = activeIndex >= 0 ? rankedResults[activeIndex] : rankedResults[0];
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
    <div data-global-search style={{ position: "relative", width: "clamp(180px, 22vw, 380px)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 36,
          padding: "0 12px",
          borderRadius: 7,
          background: "rgba(255,255,255,0.05)",
          border: `1px solid ${open ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)"}`,
          transition: "border-color 0.15s",
        }}
      >
        <Search style={{ width: 15, height: 15, color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (shouldSearch) setOpen(rankedResults.length > 0);
          }}
          placeholder="Search ticker..."
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            color: "hsl(var(--foreground))",
            fontSize: 14,
            width: "100%",
            letterSpacing: "-0.01em",
          }}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="characters"
        />
      </div>

      {open && rankedResults.length > 0 && (
        <div
          ref={listRef}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            width: "min(420px, calc(100vw - 24px))",
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
          {rankedResults.map((r, i) => (
            <div
              key={r.symbol}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                select(r.symbol);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "9px 14px",
                cursor: "pointer",
                background: i === activeIndex ? "rgba(255,255,255,0.07)" : "transparent",
                transition: "background 0.08s",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                      color: "hsl(var(--foreground))",
                      flexShrink: 0,
                    }}
                  >
                    {r.symbol}
                  </span>
                  {r.etfCategory ? (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        padding: "1.5px 4px",
                        borderRadius: 3,
                        flexShrink: 0,
                        color: ETF_COLOR[r.etfCategory] ?? "hsl(var(--primary))",
                        background: `color-mix(in srgb, ${ETF_COLOR[r.etfCategory] ?? "hsl(var(--primary))"} 15%, transparent)`,
                      }}
                    >
                      {ETF_LABEL[r.etfCategory] ?? "ETF"}
                    </span>
                  ) : r.outlook ? (
                    <span
                      style={{
                        fontSize: 12,
                        color: outlookColor(r.outlook),
                        textTransform: "capitalize",
                        opacity: 0.8,
                        flexShrink: 0,
                      }}
                    >
                      {r.outlook}
                    </span>
                  ) : null}
                </div>
                <span
                  style={{
                    fontSize: 13,
                    color: "hsl(var(--muted-foreground))",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.name}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "hsl(var(--foreground))",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  ${r.price.toFixed(2)}
                </span>
                {r.score > 0 && (
                  <span
                    style={{
                      fontSize: 12,
                      fontVariantNumeric: "tabular-nums",
                      color: r.score >= 75 ? "#4ade80" : r.score >= 50 ? "#facc15" : "hsl(var(--muted-foreground))",
                    }}
                  >
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
