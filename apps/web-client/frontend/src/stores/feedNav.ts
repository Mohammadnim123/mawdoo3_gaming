"use client";

import { create } from "zustand";
import type { FeedItem } from "@codply/contracts";

/**
 * Feed context for the full-screen player overlay (E16-F7): the ordered list
 * of slugs the viewer was scrolling when they opened a game, so next/prev
 * moves through THAT feed. Set by FeedScreen on every page it renders;
 * empty when the overlay was reached by a direct link.
 */
interface FeedNavState {
  /** Identity of the feed that populated the list (sort|genre|q). */
  contextKey: string | null;
  slugs: string[];
  /** Ask the source feed for more items (wired to fetchNextPage). */
  loadMore: (() => void) | null;
  setContext: (key: string, items: FeedItem[], loadMore: (() => void) | null) => void;
  appendItems: (key: string, items: FeedItem[]) => void;
  clear: () => void;
}

export const useFeedNav = create<FeedNavState>((set) => ({
  contextKey: null,
  slugs: [],
  loadMore: null,
  setContext: (key, items, loadMore) =>
    set({ contextKey: key, slugs: dedupe(items.map((i) => i.slug)), loadMore }),
  appendItems: (key, items) =>
    set((state) =>
      state.contextKey === key
        ? { slugs: dedupe([...state.slugs, ...items.map((i) => i.slug)]) }
        : {},
    ),
  clear: () => set({ contextKey: null, slugs: [], loadMore: null }),
}));

/** Prev/next slugs around `slug` in the captured feed order. */
export function neighbors(
  slugs: string[],
  slug: string,
): { prev: string | null; next: string | null } {
  const index = slugs.indexOf(slug);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: index > 0 ? (slugs[index - 1] ?? null) : null,
    next: index < slugs.length - 1 ? (slugs[index + 1] ?? null) : null,
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
