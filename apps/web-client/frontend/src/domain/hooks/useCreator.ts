"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { CreatorOverview, PayoutsResponse } from "@codply/contracts";
import { getServices } from "../services";

/** `GET /me/creator/overview` cache — stats, earnings, program standing. */
export const CREATOR_OVERVIEW_QUERY_KEY = ["creator-overview"] as const;
/** `GET /me/creator/payouts` cache — balance, gating, request history. */
export const CREATOR_PAYOUTS_QUERY_KEY = ["creator-payouts"] as const;

/** Creator dashboard overview; gate with `enabled` (anonymous visitors get 401). */
export function useCreatorOverview(enabled: boolean): UseQueryResult<CreatorOverview> {
  return useQuery({
    queryKey: CREATOR_OVERVIEW_QUERY_KEY,
    queryFn: () => getServices().account.creatorOverview(),
    staleTime: 30_000,
    retry: 1,
    enabled,
  });
}

/**
 * Payout balance + cursor-paged history; gate with `enabled` (anonymous
 * visitors get 401). Balance, gating and `pending` ride the head page —
 * later pages only extend the history (same shape as the credits ledger).
 */
export function useCreatorPayouts(
  enabled: boolean,
): UseInfiniteQueryResult<InfiniteData<PayoutsResponse>> {
  return useInfiniteQuery({
    queryKey: CREATOR_PAYOUTS_QUERY_KEY,
    queryFn: ({ pageParam }) => getServices().account.creatorPayouts(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    staleTime: 30_000,
    retry: 1,
    enabled,
  });
}

/**
 * Idempotency key for the payout money mutation: minted lazily ONCE per payout
 * intent and reused across retries, so a retry after a lost response replays
 * the server's answer instead of paying twice. Cleared after a successful
 * request, and whenever the snapshot stops allowing one (`can_request` false —
 * the intent the key covered is gone).
 */
export function usePayoutIdempotencyKey(canRequest: boolean): {
  mint: () => string;
  reset: () => void;
} {
  const keyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!canRequest) keyRef.current = null;
  }, [canRequest]);
  const mint = useCallback(() => (keyRef.current ??= crypto.randomUUID()), []);
  const reset = useCallback(() => {
    keyRef.current = null;
  }, []);
  return { mint, reset };
}

/** Invalidate the creator caches together — after a payout request settles. */
export function useInvalidateCreator(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: CREATOR_OVERVIEW_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: CREATOR_PAYOUTS_QUERY_KEY }),
      ]).then(() => undefined),
    [queryClient],
  );
}
