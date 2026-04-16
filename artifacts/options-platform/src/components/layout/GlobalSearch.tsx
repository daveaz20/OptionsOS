import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Search } from "lucide-react";

interface ScreenerRow {
  symbol: string;
  name: string;
  price: number;
  opportunityScore: number;
  recommendedOutlook?: string;
}

interface Result {
  symbol: string;
  name: string;
  price: number;
  score: number;
  outlook?: string;
}

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const search = useCallback(
    (q: string) => {
      const upper = q.toUpperCase().trim();
      if (!upper) {
        setResults([]);
        setOpen(false);
        return;
      }

      const cached = qc.getQueryData<ScreenerRow[]>(["screener-v3"]);
      if (cached && cached.length > 0) {
        const matched = cached
          .filter(
            (r) =>
              r.symbol.startsWith(upper) ||
              r.name.toUpperCase().includes(upper)
          )
          .sort((a, b) => {
            const aExact = a.symbol === upper ? 0 : a.symbol.startsWith(upper) ? 1 : 2;
            const bExact = b.symbol === upper ? 0 : b.symbol.startsWith(upper) ? 1 : 2;
            return aExact !== bExact ? aExact - bExact : b.opportunityScore - a.opportunityScore;
          })
          .slice(0, 8)
          .map((r) => ({
            symbol: r.symbol,
            name: r.name,
            price: r.price,
            score: r.opportunityScore,
            outlook: r.recommendedOutlook,
          }));
        setResults(matched);
        setOpen(matched.length > 0);
        return;
      }

      // Fallback: single-stock lookup via existing endpoint
      fetch(`/api/stocks/${encodeURIComponent(upper)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.symbol) {
            setResults([{ symbol: data.symbol, name: data.name, price: data.price, score: data.opportunityScore ?? 0 }]);
            setOpen(true);
          }
        })
        .catch(() => {});
    },
    [qc]
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
      if (activeIndex >= 0 && results[activeIndex]) {
        select(results[activeIndex].symbol);
      } else if (results.length > 0) {
        select(results[0].symbol);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.closest("[data-global-search]")?.contains(e.target as Node)
      ) {
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
    <div
      data-global-search
      style={{ position: "relative", width: 220 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 30,
          padding: "0 10px",
          borderRadius: 7,
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.08)",
          transition: "border-color 0.15s",
        }}
        onFocus={() => {
          (document.activeElement as HTMLElement | null)?.closest("[data-global-search]")
            ?.querySelector("div")
            ?.setAttribute("style", "border-color: rgba(255,255,255,0.18)");
        }}
      >
        <Search style={{ width: 12, height: 12, color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => query && setOpen(results.length > 0)}
          placeholder="Search ticker…"
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            color: "hsl(var(--foreground))",
            fontSize: 12,
            width: "100%",
            letterSpacing: "-0.01em",
          }}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="characters"
        />
      </div>

      {open && results.length > 0 && (
        <div
          ref={listRef}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "hsl(var(--card))",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            zIndex: 999,
            maxHeight: 300,
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
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 10px",
                cursor: "pointer",
                background: i === activeIndex ? "rgba(255,255,255,0.07)" : "transparent",
                transition: "background 0.08s",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "hsl(var(--foreground))",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {r.symbol}
                  </span>
                  {r.outlook && (
                    <span
                      style={{
                        fontSize: 10,
                        color: outlookColor(r.outlook),
                        textTransform: "capitalize",
                        opacity: 0.85,
                      }}
                    >
                      {r.outlook}
                    </span>
                  )}
                </div>
                <span
                  style={{
                    fontSize: 11,
                    color: "hsl(var(--muted-foreground))",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 140,
                  }}
                >
                  {r.name}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1, flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))" }}>
                  ${r.price.toFixed(2)}
                </span>
                {r.score > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      color:
                        r.score >= 75
                          ? "#4ade80"
                          : r.score >= 50
                          ? "#facc15"
                          : "hsl(var(--muted-foreground))",
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
