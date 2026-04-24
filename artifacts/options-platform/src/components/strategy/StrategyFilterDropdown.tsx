import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import {
  getStrategyGroups,
  STRATEGY_TIER_LABELS,
  type StrategyRegistryEntry,
} from "@/lib/strategy-catalog";
import { useSettings } from "@/contexts/SettingsContext";

interface StrategyFilterDropdownProps {
  registry: StrategyRegistryEntry[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number;
}

export function StrategyFilterDropdown({
  registry,
  value,
  onChange,
  placeholder = "All strategies",
  width = 280,
}: StrategyFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettings();
  const enabledRegistry = useMemo(
    () => registry.filter((strategy) => settings.enabledStrategyIds?.[strategy.id] !== false),
    [registry, settings.enabledStrategyIds],
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const selected = useMemo(
    () => enabledRegistry.find((strategy) => strategy.id === value) ?? null,
    [enabledRegistry, value],
  );
  const groups = useMemo(() => getStrategyGroups(enabledRegistry, search), [enabledRegistry, search]);
  const totalStrategies = enabledRegistry.length;
  const buttonLabel = selected?.name ?? (totalStrategies > 0 ? `Browse ${totalStrategies} strategies` : placeholder);

  return (
    <div ref={rootRef} style={{ position: "relative", minWidth: width }}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "6px 10px",
          borderRadius: 6,
          border: value ? "1px solid hsl(var(--primary) / 0.4)" : "1px solid rgba(255,255,255,0.1)",
          background: value ? "hsl(var(--primary) / 0.09)" : "rgba(255,255,255,0.05)",
          color: value ? "hsl(var(--primary))" : "rgba(255,255,255,0.6)",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600,
          textAlign: "left",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {buttonLabel}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          {!selected && totalStrategies > 0 && (
            <span
              style={{
                padding: "2px 6px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.72)",
                fontSize: 10,
                fontWeight: 700,
                lineHeight: 1.2,
              }}
            >
              {totalStrategies}
            </span>
          )}
          <ChevronDown style={{ width: 12, height: 12, flexShrink: 0 }} />
        </span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 200,
            width: Math.max(width, 320),
            maxWidth: "min(420px, calc(100vw - 24px))",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "#17181b",
            boxShadow: "0 20px 50px rgba(0,0,0,0.55)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 8,
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>Strategy Catalog</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>
                  {totalStrategies} strategies across all tiers
                </div>
              </div>
              {selected && (
                <button
                  type="button"
                  onClick={() => onChange("")}
                  style={{
                    padding: "5px 8px",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.04)",
                    color: "rgba(255,255,255,0.72)",
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            <div style={{ position: "relative" }}>
              <Search
                style={{
                  position: "absolute",
                  left: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 12,
                  height: 12,
                  color: "rgba(255,255,255,0.35)",
                  pointerEvents: "none",
                }}
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${totalStrategies || 40} strategies...`}
                autoFocus
                style={{
                  width: "100%",
                  padding: "7px 30px 7px 28px",
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.04)",
                  color: "#fff",
                  fontSize: 11,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  style={{
                    position: "absolute",
                    right: 7,
                    top: "50%",
                    transform: "translateY(-50%)",
                    display: "flex",
                    padding: 0,
                    border: "none",
                    background: "none",
                    color: "rgba(255,255,255,0.45)",
                    cursor: "pointer",
                  }}
                >
                  <X style={{ width: 12, height: 12 }} />
                </button>
              )}
            </div>
          </div>

          <div style={{ maxHeight: "min(70vh, 560px)", overflowY: "auto", padding: 6 }}>
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              style={{
                width: "100%",
                padding: "7px 10px",
                borderRadius: 6,
                border: "none",
                background: !value ? "rgba(10,132,255,0.14)" : "transparent",
                color: !value ? "#0a84ff" : "rgba(255,255,255,0.65)",
                fontSize: 11,
                fontWeight: 600,
                textAlign: "left",
                cursor: "pointer",
                marginBottom: 4,
              }}
            >
              {totalStrategies > 0 ? `All ${totalStrategies} strategies` : placeholder}
            </button>

            {groups.length === 0 ? (
              <div style={{ padding: "12px 10px", fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                No strategies match “{search}”.
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.tier} style={{ paddingBottom: 6 }}>
                  <div
                    style={{
                      padding: "8px 10px 4px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      color: "rgba(255,255,255,0.32)",
                      textTransform: "uppercase",
                    }}
                  >
                    <span>{STRATEGY_TIER_LABELS[group.tier] ?? group.tier}</span>
                    <span style={{ color: "rgba(255,255,255,0.24)" }}>{group.strategies.length}</span>
                  </div>
                  {group.strategies.map((strategy) => {
                    const active = strategy.id === value;
                    return (
                      <button
                        key={strategy.id}
                        type="button"
                        onClick={() => {
                          onChange(strategy.id);
                          setOpen(false);
                        }}
                        style={{
                          width: "100%",
                          padding: "7px 10px",
                          borderRadius: 6,
                          border: "none",
                          background: active ? "rgba(10,132,255,0.14)" : "transparent",
                          color: active ? "#0a84ff" : "#fff",
                          fontSize: 11,
                          fontWeight: active ? 700 : 500,
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        {strategy.name}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
