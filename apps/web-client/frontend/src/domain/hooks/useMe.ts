"use client";

import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { Me } from "@codply/contracts";
import { getServices } from "../services";

export const ME_QUERY_KEY = ["me"] as const;

/** Current account (`null` = anonymous). Single cache entry app-wide. */
export function useMe(): UseQueryResult<Me | null> {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => getServices().games.me(),
    staleTime: 30_000,
    retry: 1,
  });
}

/** Invalidate the account cache after login/logout/profile updates. */
export function useInvalidateMe(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
}
