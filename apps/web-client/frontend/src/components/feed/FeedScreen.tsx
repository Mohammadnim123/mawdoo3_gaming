"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Compass, Ghost, RefreshCw, Sparkle, TrendingUp, UsersRound, Wand2 } from "lucide-react";
import type { FeedSort } from "@codply/contracts";
import {
  Avatar,
  Button,
  Chip,
  EmptyState,
  GENRE_HUES,
  Skeleton,
  genreMeta,
  resolveIcon,
} from "@codply/ui";
import { getServices } from "@/domain/services";
import { genreLabel } from "@/domain/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMe } from "@/domain/hooks/useMe";
import { useRequireAuth } from "@/domain/hooks/useSocial";
import { useFeedNav } from "@/stores/feedNav";
import { LeftRail, RightRail } from "./FeedRails";
import { PostCard } from "./PostCard";

const PAGE_SIZE = 12;

/**
 * THE home feed (E21): a Facebook-style posts feed. Three columns — left
 * navigation rail, the posts column (composer card + PostCards, infinite
 * scroll), right discovery rail (trending + who to follow). Sorts and genre
 * filters stay; every card opens the full-screen player overlay in place.
 *
 * Islands adaptation: the entry passes `initialSort`/`initialGenre` read from
 * the URL (?sort=&genre= — Django's server-rendered home supports them);
 * everything after mount is client state, exactly like the reference.
 */
export function FeedScreen({
  initialSort = "for_you",
  initialGenre = null,
}: {
  initialSort?: FeedSort;
  initialGenre?: string | null;
} = {}): ReactElement {
  const { t, f } = useI18n();
  // E41: the home defaults to the personalized `for_you` blend.
  const [sort, setSort] = useState<FeedSort>(initialSort);
  const [genre, setGenre] = useState<string | null>(initialGenre);
  const { data: me } = useMe();
  const { gate } = useRequireAuth();
  const feedNav = useFeedNav();

  const feedQuery = useInfiniteQuery({
    queryKey: ["feed", sort, genre],
    queryFn: ({ pageParam }) =>
      getServices().games.feed({
        sort,
        genre: genre ?? undefined,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const sentinelRef = useRef<HTMLDivElement>(null);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = feedQuery;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((e) => e.isIntersecting) && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "900px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const items = useMemo(
    () => feedQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [feedQuery.data],
  );

  // Publish this feed as the overlay's navigation context (E16-F7).
  const contextKey = `${sort}|${genre ?? ""}`;
  useEffect(() => {
    if (items.length > 0) {
      feedNav.setContext(contextKey, items, () => {
        void fetchNextPage();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey, items]);

  const pickSort = (next: FeedSort): void => {
    if (next === "following" && !me) {
      gate(); // routes to /login?next=…
      return;
    }
    setSort(next);
  };

  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 px-4 py-4 sm:py-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,600px)_300px] xl:justify-center">
      {/* Left rail — sticky nav (≥lg). */}
      <div className="hidden lg:block">
        <div className="sticky top-20">
          <LeftRail sort={sort} onPickSort={pickSort} />
        </div>
      </div>

      {/* Center — the posts column. */}
      <main className="flex min-w-0 flex-col gap-4">
        <ComposerCard />

        <header className="flex flex-col gap-3">
          {/* Sort chips duplicate the rail on small screens (rail hidden).
              Title search now lives in the header (HeaderSearch → /search). */}
          <div className="flex flex-wrap items-center gap-2 lg:hidden" role="group" aria-label={t.feed.sort}>
            <Chip
              selected={sort === "for_you"}
              onClick={() => pickSort("for_you")}
              leading={<Compass className="size-3.5" aria-hidden />}
            >
              {t.feed.forYou}
            </Chip>
            <Chip
              selected={sort === "trending"}
              onClick={() => pickSort("trending")}
              leading={<TrendingUp className="size-3.5" aria-hidden />}
            >
              {t.feed.trending}
            </Chip>
            <Chip
              selected={sort === "new"}
              onClick={() => pickSort("new")}
              leading={<Sparkle className="size-3.5" aria-hidden />}
            >
              {t.feed.new}
            </Chip>
            <Chip
              selected={sort === "following"}
              onClick={() => pickSort("following")}
              leading={<UsersRound className="size-3.5" aria-hidden />}
            >
              {t.feed.following}
            </Chip>
          </div>
          {/* One thumb-scrollable row on phones (snap + edge fade), wraps ≥sm. */}
          <div
            className="fp-scroll-x -mx-4 gap-2 px-4 sm:mx-0 sm:flex-wrap sm:overflow-x-visible sm:px-0 sm:[mask-image:none]"
            role="group"
            aria-label={t.feed.filterByGenre}
          >
            {Object.keys(GENRE_HUES).map((key) => {
              const meta = genreMeta(key);
              const Icon = resolveIcon(meta.icon);
              return (
                <Chip
                  key={key}
                  selected={genre === key}
                  accent={meta.hue}
                  onClick={() => setGenre((current) => (current === key ? null : key))}
                  leading={<Icon className="size-3.5" aria-hidden />}
                >
                  {genreLabel(t, key)}
                </Chip>
              );
            })}
          </div>
        </header>

        {feedQuery.isPending && (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-[420px] w-full rounded-2xl" />
            ))}
          </div>
        )}

        {feedQuery.isError && (
          <EmptyState
            icon={Ghost}
            title={t.feed.errorTitle}
            description={t.feed.errorDescription}
            action={
              <Button
                variant="soft"
                onClick={() => void feedQuery.refetch()}
                leftIcon={<RefreshCw className="size-4" aria-hidden />}
              >
                {t.common.retry}
              </Button>
            }
          />
        )}

        {feedQuery.isSuccess && items.length === 0 && (
          <EmptyState
            icon={sort === "following" ? UsersRound : Ghost}
            title={sort === "following" ? t.feed.emptyFollowingTitle : t.feed.emptyTitle}
            description={
              sort === "following"
                ? t.feed.emptyFollowingDescription
                : genre
                  ? f.msg(t.feed.emptyGenreDescription, { genre: genreLabel(t, genre) })
                  : t.feed.emptyDescription
            }
            action={
              sort === "following" ? (
                <Button variant="soft" onClick={() => setSort("trending")}>
                  {t.feed.browseTrending}
                </Button>
              ) : undefined
            }
          />
        )}

        {items.length > 0 && (
          <div className="flex flex-col gap-4" data-testid="post-feed">
            {items.map((game) => (
              <PostCard key={game.id} game={game} />
            ))}
          </div>
        )}

        {isFetchingNextPage && <Skeleton className="h-[420px] w-full rounded-2xl" />}
        <div ref={sentinelRef} aria-hidden />
      </main>

      {/* Right rail — discovery (≥xl). */}
      <div className="hidden xl:block">
        <div className="sticky top-20">
          <RightRail />
        </div>
      </div>
    </div>
  );
}

/** FB's "what's on your mind" — here it's "what will you build" (E21). */
function ComposerCard(): ReactElement {
  const { t } = useI18n();
  const { data: me } = useMe();
  return (
    <Link
      href="/create"
      className="flex items-center gap-3 rounded-2xl border border-edge bg-surface-1 p-3 transition-colors hover:border-violet/50"
      data-testid="feed-composer"
    >
      <Avatar
        name={me?.display_name || me?.handle || t.common.you}
        src={me?.avatar_url ?? undefined}
        size="md"
      />
      <span className="flex-1 truncate rounded-full bg-surface-2 px-4 py-2.5 text-sm text-ink-muted">
        {t.feed.composerPrompt}
      </span>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet text-white">
        <Wand2 className="size-4" aria-hidden />
      </span>
    </Link>
  );
}
