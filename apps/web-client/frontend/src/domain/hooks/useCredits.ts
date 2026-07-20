"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { SubscriptionResponse } from "@codply/contracts";
import { getServices } from "../services";

/** Balance + ledger cache (the Credits dialog pages it infinitely). */
export const CREDITS_QUERY_KEY = ["credits"] as const;
/** `GET /me/subscription` cache — plan card, meter, daily-claim gating. */
export const SUBSCRIPTION_QUERY_KEY = ["subscription"] as const;

/** Current subscription; gate with `enabled` (anonymous visitors get 401). */
export function useSubscription(enabled = true): UseQueryResult<SubscriptionResponse> {
  return useQuery({
    queryKey: SUBSCRIPTION_QUERY_KEY,
    queryFn: () => getServices().account.subscription(),
    staleTime: 30_000,
    retry: 1,
    enabled,
  });
}

/**
 * Invalidate the credit caches together — after claim-daily, checkout and
 * job completion (the worker settles the spend on done).
 */
export function useInvalidateCredits(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: CREDITS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_QUERY_KEY }),
      ]).then(() => undefined),
    [queryClient],
  );
}
