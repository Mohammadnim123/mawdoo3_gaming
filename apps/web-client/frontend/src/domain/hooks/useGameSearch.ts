"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FeedItem } from "@codply/contracts";
import { getServices } from "../services";

/** Stable typeahead cache prefix — the full key is `[SEARCH_QUERY_KEY, q, limit]`. */
export const SEARCH_QUERY_KEY = "search" as const;

/** Below this length we never hit the network (trigram search is noisy on 1 char). */
export const SEARCH_MIN_LENGTH = 2;

/** Debounce the INPUT value, not the query fn (250ms typeahead). */
const DEBOUNCE_MS = 250;

export interface GameSearchResult {
  items: FeedItem[];
  isLoading: boolean;
  isError: boolean;
  /** The DEBOUNCED, trimmed term actually being queried (may lag the input). */
  query: string;
}

/**
 * Debounced react-query typeahead over the game title search. Powers BOTH the
 * header dropdown (small `limit`, e.g. 6) and the /search page (larger limit)
 * off one cache — `limit` rides the query key so the two never collide.
 *
 * The query only runs once the trimmed term is ≥ `SEARCH_MIN_LENGTH`; results
 * stay fresh for 30s so re-opening the dropdown for the same term is instant.
 */
export function useGameSearch(raw: string, limit = 6): GameSearchResult {
  const [debounced, setDebounced] = useState(() => raw.trim());

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(raw.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [raw]);

  const trimmed = raw.trim();
  const enabled = debounced.length >= SEARCH_MIN_LENGTH;
  const query = useQuery({
    queryKey: [SEARCH_QUERY_KEY, debounced, limit],
    queryFn: () => getServices().search.searchGames(debounced, limit),
    enabled,
    staleTime: 30_000,
  });

  // While the debounce timer is still settling on a fresh ≥2-char term, report
  // loading so the dropdown shows skeletons instead of flashing stale rows.
  const settling = trimmed !== debounced && trimmed.length >= SEARCH_MIN_LENGTH;

  return {
    items: query.data ?? [],
    isLoading: settling || (enabled && query.isLoading),
    isError: query.isError,
    query: debounced,
  };
}
