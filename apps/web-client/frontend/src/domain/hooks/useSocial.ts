"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import type { FeedItem, GameDetail } from "@codply/contracts";
import { getServices } from "@/domain/services";
import { getPlaySessionHash } from "@/domain/playSession";
import { useMe } from "./useMe";

type Engageable = Pick<FeedItem, "id" | "slug"> & {
  like_count: number;
  save_count: number;
  viewer: FeedItem["viewer"];
};

/** Saved-games library cache (`GET /me/saves`). */
export const MY_SAVES_QUERY_KEY = ["my-saves"] as const;
/** Liked-games library cache (`GET /me/likes`, E36). */
export const MY_LIKES_QUERY_KEY = ["my-likes"] as const;
/** Play-history library cache (`GET /me/history`, E36). */
export const MY_HISTORY_QUERY_KEY = ["my-history"] as const;

/**
 * Infinite (useInfiniteQuery) variants of the library keys. A plain useQuery
 * and a useInfiniteQuery must NEVER share a query key — they cache different
 * shapes ({items} vs InfiniteData) and whichever mounts second throws inside
 * query-core's infiniteQueryBehavior. Deriving these from the base keys keeps
 * prefix invalidation (invalidateQueries({queryKey: MY_*_QUERY_KEY})) matching
 * both consumers.
 */
export const MY_SAVES_INFINITE_QUERY_KEY = [...MY_SAVES_QUERY_KEY, "infinite"] as const;
export const MY_LIKES_INFINITE_QUERY_KEY = [...MY_LIKES_QUERY_KEY, "infinite"] as const;
export const MY_HISTORY_INFINITE_QUERY_KEY = [...MY_HISTORY_QUERY_KEY, "infinite"] as const;

interface GameCachePatch {
  liked?: boolean;
  saved?: boolean;
  likeDelta?: number;
  saveDelta?: number;
  commentDelta?: number;
}

/**
 * Patch one game across EVERY query cache that may hold it: feed pages
 * (infinite), profile games, saved library, and game-detail entries.
 * Optimistic-update core for the like/save toggles (E16-F1).
 */
export function patchGameCaches(
  queryClient: QueryClient,
  gameId: string,
  patch: GameCachePatch,
): void {
  const apply = <T extends Engageable & { comment_count?: number }>(game: T): T => {
    if (game.id !== gameId) return game;
    const viewer = game.viewer ?? { liked: false, saved: false };
    return {
      ...game,
      like_count: Math.max(0, game.like_count + (patch.likeDelta ?? 0)),
      save_count: Math.max(0, game.save_count + (patch.saveDelta ?? 0)),
      ...(game.comment_count !== undefined
        ? { comment_count: Math.max(0, game.comment_count + (patch.commentDelta ?? 0)) }
        : {}),
      viewer: { ...viewer, liked: patch.liked ?? viewer.liked, saved: patch.saved ?? viewer.saved },
    };
  };

  // Infinite lists ({pages: [{items}]}) — feed, profile games, saved library.
  queryClient.setQueriesData<{ pages?: { items: FeedItem[] }[] }>(
    {
      predicate: (query) =>
        ["feed", "profile-games", "my-saves", "my-likes", "my-history"].includes(
          String(query.queryKey[0]),
        ),
    },
    (data) =>
      data?.pages
        ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map(apply) })) }
        : data,
  );
  // Single game detail entries (["game", slug] / ["overlay-game", slug]).
  queryClient.setQueriesData<GameDetail>(
    {
      predicate: (query) => ["game", "overlay-game"].includes(String(query.queryKey[0])),
    },
    (data) => (data ? apply(data) : data),
  );
}

/** Redirect anonymous users to login, preserving where they were. */
export function useRequireAuth(): { me: ReturnType<typeof useMe>["data"]; gate: () => boolean } {
  const { data: me } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const gate = (): boolean => {
    if (me) return true;
    router.push(`/login?next=${encodeURIComponent(pathname)}`);
    return false;
  };
  return { me, gate };
}

/** Optimistic like/unlike toggle (rolls back on error). */
export function useLikeToggle(game: Engageable): { liked: boolean; toggle: () => void } {
  const queryClient = useQueryClient();
  const { gate } = useRequireAuth();
  const liked = game.viewer?.liked ?? false;

  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      next ? getServices().social.like(game.id) : getServices().social.unlike(game.id),
    onMutate: (next) => {
      patchGameCaches(queryClient, game.id, { liked: next, likeDelta: next ? 1 : -1 });
    },
    onError: (_err, next) => {
      patchGameCaches(queryClient, game.id, { liked: !next, likeDelta: next ? -1 : 1 });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: MY_LIKES_QUERY_KEY }),
  });

  return {
    liked,
    toggle: () => {
      if (gate()) mutation.mutate(!liked);
    },
  };
}

/** Optimistic save/unsave toggle. */
export function useSaveToggle(game: Engageable): { saved: boolean; toggle: () => void } {
  const queryClient = useQueryClient();
  const { gate } = useRequireAuth();
  const saved = game.viewer?.saved ?? false;

  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      next ? getServices().social.save(game.id) : getServices().social.unsave(game.id),
    onMutate: (next) => {
      patchGameCaches(queryClient, game.id, { saved: next, saveDelta: next ? 1 : -1 });
    },
    onError: (_err, next) => {
      patchGameCaches(queryClient, game.id, { saved: !next, saveDelta: next ? -1 : 1 });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: MY_SAVES_QUERY_KEY }),
  });

  return {
    saved,
    toggle: () => {
      if (gate()) mutation.mutate(!saved);
    },
  };
}

/**
 * Share: native share sheet when available, else copy to clipboard.
 * Reports the share to the API (anonymous, deduped server-side).
 */
export function useShare(): (game: { id: string; slug: string; title: string }) => Promise<
  "shared" | "copied"
> {
  return async (game) => {
    const url = new URL(`/g/${game.slug}`, window.location.origin).toString();
    let outcome: "shared" | "copied" = "copied";
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: game.title, url });
        outcome = "shared";
      } catch {
        return "copied"; // user dismissed the sheet — no ping, no toast lie
      }
    } else {
      await navigator.clipboard.writeText(url);
    }
    getServices()
      .social.share(game.id, getPlaySessionHash())
      .catch(() => {
        // share pings are best-effort
      });
    return outcome;
  };
}

/** Follow/unfollow with profile-cache sync. */
export function useFollowToggle(handle: string, following: boolean): { toggle: () => void } {
  const queryClient = useQueryClient();
  const { gate } = useRequireAuth();

  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      next ? getServices().social.follow(handle) : getServices().social.unfollow(handle),
    onMutate: (next) => {
      queryClient.setQueryData(
        ["profile", handle],
        (
          profile:
            | { stats: { followers: number }; viewer: { following: boolean } | null }
            | undefined,
        ) =>
          profile
            ? {
                ...profile,
                stats: {
                  ...profile.stats,
                  followers: Math.max(0, profile.stats.followers + (next ? 1 : -1)),
                },
                viewer: { following: next },
              }
            : profile,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["profile", handle] }),
  });

  return {
    toggle: () => {
      if (gate()) mutation.mutate(!following);
    },
  };
}

/** Unread notifications badge — polls every 30s + on focus (E16-F5). */
export function useUnreadCount(): number {
  const { data: me } = useMe();
  const query = useQuery({
    queryKey: ["unread-count"],
    queryFn: () => getServices().social.unreadCount(),
    enabled: !!me,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  return query.data?.count ?? 0;
}
