import { useQuery } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type {
  OptionsChain,
  AccountBalances,
  AccountPositionsResponse,
  AccountSummary,
} from "@workspace/api-zod";

// ─── Options Chain ────────────────────────────────────────────────────────

export const getOptionsChainQueryKey = (symbol: string) =>
  ["options-chain", symbol] as const;

export function useGetOptionsChain(
  symbol: string,
  options?: { query?: { enabled?: boolean; staleTime?: number; refetchInterval?: number } },
) {
  return useQuery<OptionsChain>({
    queryKey: getOptionsChainQueryKey(symbol),
    queryFn: () =>
      customFetch<OptionsChain>(`/api/stocks/${encodeURIComponent(symbol)}/options-chain`),
    enabled: options?.query?.enabled ?? !!symbol,
    staleTime: options?.query?.staleTime ?? 5 * 60 * 1000,
    refetchInterval: options?.query?.refetchInterval ?? 5 * 60 * 1000,
  });
}

// ─── Account Balances ─────────────────────────────────────────────────────

export const getAccountBalancesQueryKey = () => ["account-balances"] as const;

export function useGetAccountBalances(
  options?: { query?: { enabled?: boolean } },
) {
  return useQuery<AccountBalances>({
    queryKey: getAccountBalancesQueryKey(),
    queryFn: () => customFetch<AccountBalances>("/api/account/balances"),
    enabled: options?.query?.enabled ?? true,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });
}

// ─── Account Positions ────────────────────────────────────────────────────

export const getAccountPositionsQueryKey = () => ["account-positions"] as const;

export function useGetAccountPositions(
  options?: { query?: { enabled?: boolean } },
) {
  return useQuery<AccountPositionsResponse>({
    queryKey: getAccountPositionsQueryKey(),
    queryFn: () => customFetch<AccountPositionsResponse>("/api/account/positions"),
    enabled: options?.query?.enabled ?? true,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}

// ─── Account Summary ──────────────────────────────────────────────────────

export const getAccountSummaryQueryKey = () => ["account-summary"] as const;

export function useGetAccountSummary(
  options?: { query?: { enabled?: boolean } },
) {
  return useQuery<AccountSummary>({
    queryKey: getAccountSummaryQueryKey(),
    queryFn: () => customFetch<AccountSummary>("/api/account/summary"),
    enabled: options?.query?.enabled ?? true,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });
}
