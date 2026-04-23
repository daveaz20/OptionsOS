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
  "all-star": "All-Star",
};

export function useStrategyRegistry() {
  return useQuery<StrategyRegistryEntry[]>({
    queryKey: ["strategy-registry"],
    queryFn: async () => {
      const res = await fetch("/api/strategies");
      if (!res.ok) throw new Error("Failed to load strategy registry");
      return res.json();
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
