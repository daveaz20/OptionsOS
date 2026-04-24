import { useQuery } from "@tanstack/react-query";

export interface StrategyRegistryEntry {
  id: string;
  name: string;
  tier: string;
}

export interface StrategyMatchSummary {
  id: string;
  name: string;
  fitScore: number;
  fitReason: string;
  tier: string;
  url?: string;
}

export const FALLBACK_STRATEGY_REGISTRY: StrategyRegistryEntry[] = [
  { id: "covered_call", name: "Covered Call", tier: "rookie" },
  { id: "protective_put", name: "Protective Put", tier: "rookie" },
  { id: "collar", name: "Collar", tier: "rookie" },
  { id: "cash_secured_put", name: "Cash-Secured Put", tier: "rookie" },
  { id: "long_call", name: "Long Call", tier: "veteran" },
  { id: "long_put", name: "Long Put", tier: "veteran" },
  { id: "fig_leaf", name: "Fig Leaf", tier: "veteran" },
  { id: "long_call_spread", name: "Long Call Spread", tier: "veteran" },
  { id: "long_put_spread", name: "Long Put Spread", tier: "veteran" },
  { id: "short_call_spread", name: "Short Call Spread", tier: "seasoned-veteran" },
  { id: "short_put_spread", name: "Short Put Spread", tier: "seasoned-veteran" },
  { id: "long_straddle", name: "Long Straddle", tier: "seasoned-veteran" },
  { id: "long_strangle", name: "Long Strangle", tier: "seasoned-veteran" },
  { id: "back_spread_calls", name: "Back Spread w/Calls", tier: "seasoned-veteran" },
  { id: "back_spread_puts", name: "Back Spread w/Puts", tier: "seasoned-veteran" },
  { id: "long_calendar_calls", name: "Long Calendar Spread w/Calls", tier: "seasoned-veteran" },
  { id: "long_calendar_puts", name: "Long Calendar Spread w/Puts", tier: "seasoned-veteran" },
  { id: "diagonal_spread_calls", name: "Diagonal Spread w/Calls", tier: "seasoned-veteran" },
  { id: "diagonal_spread_puts", name: "Diagonal Spread w/Puts", tier: "seasoned-veteran" },
  { id: "long_butterfly_calls", name: "Long Butterfly w/Calls", tier: "seasoned-veteran" },
  { id: "long_butterfly_puts", name: "Long Butterfly w/Puts", tier: "seasoned-veteran" },
  { id: "iron_butterfly", name: "Iron Butterfly", tier: "seasoned-veteran" },
  { id: "skip_strike_butterfly_calls", name: "Skip Strike Butterfly w/Calls", tier: "seasoned-veteran" },
  { id: "skip_strike_butterfly_puts", name: "Skip Strike Butterfly w/Puts", tier: "seasoned-veteran" },
  { id: "inverse_skip_strike_butterfly_calls", name: "Inverse Skip Strike Butterfly w/Calls", tier: "seasoned-veteran" },
  { id: "inverse_skip_strike_butterfly_puts", name: "Inverse Skip Strike Butterfly w/Puts", tier: "seasoned-veteran" },
  { id: "christmas_tree_butterfly_calls", name: "Christmas Tree Butterfly w/Calls", tier: "seasoned-veteran" },
  { id: "christmas_tree_butterfly_puts", name: "Christmas Tree Butterfly w/Puts", tier: "seasoned-veteran" },
  { id: "long_condor_calls", name: "Long Condor Spread w/Calls", tier: "seasoned-veteran" },
  { id: "long_condor_puts", name: "Long Condor Spread w/Puts", tier: "seasoned-veteran" },
  { id: "iron_condor", name: "Iron Condor", tier: "seasoned-veteran" },
  { id: "short_call", name: "Short Call", tier: "all-star" },
  { id: "short_put", name: "Short Put", tier: "all-star" },
  { id: "short_straddle", name: "Short Straddle", tier: "all-star" },
  { id: "short_strangle", name: "Short Strangle", tier: "all-star" },
  { id: "long_combination", name: "Long Combination", tier: "all-star" },
  { id: "short_combination", name: "Short Combination", tier: "all-star" },
  { id: "front_spread_calls", name: "Front Spread w/Calls", tier: "all-star" },
  { id: "front_spread_puts", name: "Front Spread w/Puts", tier: "all-star" },
  { id: "double_diagonal", name: "Double Diagonal", tier: "all-star" },
];

export const STRATEGY_TIER_ORDER = [
  "rookie",
  "veteran",
  "seasoned-veteran",
  "all-star",
] as const;

export const STRATEGY_TIER_LABELS: Record<string, string> = {
  rookie: "Rookie",
  veteran: "Veteran",
  "seasoned-veteran": "Seasoned Veteran",
  "all-star": "Expert",
};

export function useStrategyRegistry() {
  return useQuery<StrategyRegistryEntry[]>({
    queryKey: ["strategy-registry"],
    queryFn: async () => {
      const mergedRegistry = new Map(
        FALLBACK_STRATEGY_REGISTRY.map((strategy) => [strategy.id, strategy]),
      );

      try {
        const res = await fetch("/api/strategies");
        if (!res.ok) throw new Error("Failed to load strategy registry");
        const remoteRegistry = (await res.json()) as StrategyRegistryEntry[];

        for (const strategy of remoteRegistry) {
          if (!strategy?.id || !strategy?.name || !strategy?.tier) continue;
          mergedRegistry.set(strategy.id, {
            id: strategy.id,
            name: strategy.name,
            tier: strategy.tier,
          });
        }
      } catch {
        // Keep the built-in 40 strategy catalog available even if the API is stale.
      }

      return Array.from(mergedRegistry.values()).sort((left, right) => {
        const tierDelta =
          STRATEGY_TIER_ORDER.indexOf(left.tier as (typeof STRATEGY_TIER_ORDER)[number]) -
          STRATEGY_TIER_ORDER.indexOf(right.tier as (typeof STRATEGY_TIER_ORDER)[number]);
        if (tierDelta !== 0) return tierDelta;
        return left.name.localeCompare(right.name);
      });
    },
    staleTime: Infinity,
  });
}

export function getStrategyMatches(
  item: { topStrategies?: StrategyMatchSummary[] } | null | undefined,
): StrategyMatchSummary[] {
  return item?.topStrategies ?? [];
}

export function getMatchedStrategy(
  item: { topStrategies?: StrategyMatchSummary[] } | null | undefined,
  strategyId: string,
): StrategyMatchSummary | null {
  if (!strategyId) return null;
  return getStrategyMatches(item).find((strategy) => strategy.id === strategyId) ?? null;
}

export function getStrategyGroups(
  registry: StrategyRegistryEntry[],
  search: string,
): Array<{ tier: string; strategies: StrategyRegistryEntry[] }> {
  const query = search.trim().toLowerCase();
  const filtered = query
    ? registry.filter((strategy) =>
        strategy.name.toLowerCase().includes(query) ||
        strategy.id.toLowerCase().includes(query) ||
        strategy.tier.toLowerCase().includes(query),
      )
    : registry;

  return STRATEGY_TIER_ORDER
    .map((tier) => ({
      tier,
      strategies: filtered.filter((strategy) => strategy.tier === tier),
    }))
    .filter((group) => group.strategies.length > 0);
}
