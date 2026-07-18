"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Bookmark,
  CalendarDays,
  Gamepad2,
  Heart,
  History,
  LayoutDashboard,
  LayoutGrid,
  MessageCircle,
  Play,
  UserRoundPen,
  UserRoundX,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { ApiError, type FeedItem, type PaginatedResponse } from "@codply/contracts";
import {
  Avatar,
  Button,
  CopyButton,
  EmptyState,
  GameCard,
  Notice,
  Skeleton,
  StatPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@codply/ui";
import { getServices } from "@/domain/services";
import { genreLabel } from "@/domain/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMe } from "@/domain/hooks/useMe";
import {
  MY_HISTORY_INFINITE_QUERY_KEY,
  MY_LIKES_INFINITE_QUERY_KEY,
  MY_SAVES_INFINITE_QUERY_KEY,
} from "@/domain/hooks/useSocial";
import { useFeedNav } from "@/stores/feedNav";
import { FollowButton } from "@/components/social/FollowButton";
import { AvatarUpload } from "@/components/profile/AvatarUpload";

const PAGE_SIZE = 24;

type ProfileTab = "games" | "liked" | "saved" | "history";

/**
 * Public creator profile (E16-F4): identity + bio, follower/engagement stats,
 * follow button, and the creator's public games (tap → overlay player).
 * On your own handle it grows an avatar upload, quick actions and private
 * liked/saved/history library tabs (E36).
 */
export function ProfileScreen({ handle }: { handle: string }): ReactElement {
  const { t, f } = useI18n();
  const feedNav = useFeedNav();
  const { data: me } = useMe();
  const isSelf = me?.handle === handle;
  const [tab, setTab] = useState<ProfileTab>("games");

  const profileQuery = useQuery({
    queryKey: ["profile", handle],
    queryFn: () => getServices().social.profile(handle),
    staleTime: 60_000,
    retry: (count, error) =>
      !(ApiError.isApiError(error) && error.code === "not_found") && count < 2,
  });

  const gamesQuery = useInfiniteQuery({
    queryKey: ["profile-games", handle],
    queryFn: ({ pageParam }) =>
      getServices().social.profileGames(handle, { cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: profileQuery.isSuccess,
  });

  const games = useMemo(
    () => gamesQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [gamesQuery.data],
  );

  // Profile grid is a valid overlay-nav context too (E16-F7). Each tab owns
  // the overlay context while it is visible (the library tabs register their
  // own — see LibraryGrid), so prev/next never walks the public games list
  // while a liked/saved/history grid is on screen.
  useEffect(() => {
    if (tab === "games" && games.length > 0) {
      feedNav.setContext(`profile|${handle}`, games, () => {
        void gamesQuery.fetchNextPage();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, games, tab]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = gamesQuery;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((e) => e.isIntersecting) && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  if (profileQuery.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
        <div className="flex items-center gap-4">
          <Skeleton className="size-24 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="fp-game-grid">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="aspect-[16/12] w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const profile = profileQuery.data;
  if (profileQuery.isError || !profile) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <EmptyState
          icon={UserRoundX}
          title={f.msg(t.profile.notFoundTitle, { handle })}
          description={t.profile.notFoundDescription}
        />
      </div>
    );
  }

  const name = profile.user.display_name ?? profile.user.handle;
  const profileUrl = `${typeof window === "undefined" ? "" : window.location.origin}/u/${handle}`;
  // Islands adaptation: Vite exposes env as import.meta.env (NEXT_PUBLIC_ →
  // VITE_); typed via cast because the islands tsconfig omits vite/client.
  const discordUrl = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_DISCORD_URL;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:gap-6 sm:py-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          {isSelf ? (
            <AvatarUpload name={name} src={profile.user.avatar_url} handle={handle} />
          ) : (
            <Avatar name={name} src={profile.user.avatar_url ?? undefined} size="xl" />
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="fp-title-page font-[family-name:var(--font-space-grotesk)] font-bold">
              {name}
            </h1>
            <span className="inline-flex w-fit items-center gap-1 rounded-full border border-edge px-2 text-sm text-ink-muted">
              <span dir="ltr">@{profile.user.handle}</span>
              <CopyButton
                text={profileUrl}
                aria-label={t.profile.copyProfileUrl}
                copiedLabel={t.profile.copiedProfileUrl}
              />
            </span>
          </div>
          <div className="sm:ms-auto">
            <FollowButton
              handle={profile.user.handle}
              following={profile.viewer?.following ?? false}
              size="md"
            />
          </div>
        </div>

        {profile.user.bio && (
          <p className="max-w-xl whitespace-pre-wrap text-sm text-ink-secondary">
            {profile.user.bio}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/u/${handle}/followers`}
            className="rounded-md underline-offset-2 transition-colors hover:text-ink hover:underline"
          >
            <StatPill icon={UsersRound} value={profile.stats.followers} label={t.game.followers} />
          </Link>
          <Link
            href={`/u/${handle}/following`}
            className="rounded-md underline-offset-2 transition-colors hover:text-ink hover:underline"
          >
            <StatPill icon={UsersRound} value={profile.stats.following} label={t.game.followingStat} />
          </Link>
          <StatPill icon={Gamepad2} value={profile.stats.games} label={t.game.games} />
          <StatPill icon={Play} value={profile.stats.plays} label={t.game.plays} />
          <StatPill icon={Heart} value={profile.stats.likes} label={t.game.likes} />
          <span className="flex items-center gap-1 text-xs text-ink-muted">
            <CalendarDays className="size-3.5" aria-hidden />
            {f.msg(t.game.joined, { date: f.monthYear(profile.user.created_at) })}
          </span>
        </div>

        {isSelf && (
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/me">
              <Button variant="soft" size="sm" leftIcon={<UserRoundPen className="size-4" aria-hidden />}>
                {t.profile.editProfile}
              </Button>
            </Link>
            <Link href="/studio">
              <Button variant="soft" size="sm" leftIcon={<Gamepad2 className="size-4" aria-hidden />}>
                {t.profile.studio}
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="soft" size="sm" leftIcon={<LayoutDashboard className="size-4" aria-hidden />}>
                {t.profile.dashboard}
              </Button>
            </Link>
            {discordUrl && (
              <a
                href={discordUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={t.profile.discord}
                title={t.profile.discord}
                className="fp-hit inline-flex size-8 items-center justify-center rounded-xl border border-edge bg-surface-2 text-ink-secondary transition-colors duration-200 ease-out hover:bg-surface-3 hover:text-ink"
              >
                <MessageCircle className="size-4" aria-hidden />
              </a>
            )}
          </div>
        )}
      </header>

      <Tabs value={tab} onValueChange={(next) => setTab(next as ProfileTab)}>
        <TabsList aria-label={t.profile.profileTabs}>
          <TabsTrigger value="games" icon={LayoutGrid}>
            {t.profile.tabGames}
          </TabsTrigger>
          {isSelf && (
            <>
              <TabsTrigger value="liked" icon={Heart}>
                {t.profile.tabLiked}
              </TabsTrigger>
              <TabsTrigger value="saved" icon={Bookmark}>
                {t.profile.tabSaved}
              </TabsTrigger>
              <TabsTrigger value="history" icon={History}>
                {t.profile.tabHistory}
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="games" className="flex flex-col gap-5 pt-4 sm:gap-6">
          {gamesQuery.isSuccess && games.length === 0 && (
            <EmptyState
              icon={Gamepad2}
              title={t.profile.noGamesTitle}
              description={t.profile.noGamesDescription}
            />
          )}

          {games.length > 0 && (
            <div className="fp-game-grid">
              {games.map((game) => (
                <Link key={game.id} href={`/g/${game.slug}`} className="contents" scroll={false}>
                  <GameCard
                    game={game}
                    labels={{
                      play: t.post.playGame,
                      plays: t.game.plays,
                      likes: t.game.likes,
                      comments: t.game.comments,
                      remixes: t.game.remixes,
                      genre: game.genre ? genreLabel(t, game.genre) : undefined,
                    }}
                  />
                </Link>
              ))}
            </div>
          )}
          {isFetchingNextPage && (
            <div className="fp-game-grid">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="aspect-[16/12] w-full rounded-2xl" />
              ))}
            </div>
          )}
          <div ref={sentinelRef} aria-hidden />
        </TabsContent>

        {isSelf && (
          <>
            <TabsContent value="liked" className="flex flex-col gap-5 pt-4 sm:gap-6">
              <LibraryGrid
                queryKey={MY_LIKES_INFINITE_QUERY_KEY}
                navContextKey={`profile|${handle}|liked`}
                fetcher={(cursor) => getServices().social.myLikes({ cursor, limit: PAGE_SIZE })}
                emptyIcon={Heart}
                emptyTitle={t.profile.likedEmptyTitle}
                emptyDescription={t.profile.likedEmptyDescription}
                enabled={isSelf}
              />
            </TabsContent>
            <TabsContent value="saved" className="flex flex-col gap-5 pt-4 sm:gap-6">
              <LibraryGrid
                queryKey={MY_SAVES_INFINITE_QUERY_KEY}
                navContextKey={`profile|${handle}|saved`}
                fetcher={(cursor) => getServices().social.mySaves({ cursor, limit: PAGE_SIZE })}
                emptyIcon={Bookmark}
                emptyTitle={t.profile.savedEmptyTitle}
                emptyDescription={t.profile.savedEmptyDescription}
                enabled={isSelf}
              />
            </TabsContent>
            <TabsContent value="history" className="flex flex-col gap-5 pt-4 sm:gap-6">
              <LibraryGrid
                queryKey={MY_HISTORY_INFINITE_QUERY_KEY}
                navContextKey={`profile|${handle}|history`}
                fetcher={(cursor) => getServices().social.myHistory({ cursor, limit: PAGE_SIZE })}
                emptyIcon={History}
                emptyTitle={t.profile.historyEmptyTitle}
                emptyDescription={t.profile.historyEmptyDescription}
                enabled={isSelf}
              />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

/**
 * Private library tab body (E36): the same infinite Link+GameCard grid the
 * games tab uses, over /me/likes | /me/saves | /me/history. Mounted only
 * while its tab is active (TabsContent unmounts inactive panels), and the
 * query additionally gates on `enabled` so visitors never fetch.
 */
function LibraryGrid({
  queryKey,
  navContextKey,
  fetcher,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  enabled,
}: {
  queryKey: readonly string[];
  /** Overlay-nav context id for THIS grid (`profile|handle|liked` …). */
  navContextKey: string;
  fetcher: (cursor?: string) => Promise<PaginatedResponse<FeedItem>>;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
  enabled: boolean;
}): ReactElement {
  const { t } = useI18n();
  const feedNav = useFeedNav();
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetcher(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled,
  });

  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  const sentinelRef = useRef<HTMLDivElement>(null);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  // While this tab is on screen (TabsContent unmounts inactive panels), the
  // player overlay must navigate within THIS grid — never the public games
  // list (E16-F7). Same registration pattern as FeedScreen/the games tab.
  useEffect(() => {
    if (items.length > 0) {
      feedNav.setContext(navContextKey, items, () => {
        void fetchNextPage();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navContextKey, items]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((e) => e.isIntersecting) && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  if (query.isPending) {
    return (
      <div className="fp-game-grid">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="aspect-[16/12] w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <Notice
        tone="danger"
        action={
          <Button variant="soft" size="sm" onClick={() => void query.refetch()}>
            {t.common.retry}
          </Button>
        }
      >
        {t.profile.libraryError}
      </Notice>
    );
  }

  if (query.isSuccess && items.length === 0) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <>
      <div className="fp-game-grid">
        {items.map((game) => (
          <Link key={game.id} href={`/g/${game.slug}`} className="contents" scroll={false}>
            <GameCard
              game={game}
              labels={{
                play: t.post.playGame,
                plays: t.game.plays,
                likes: t.game.likes,
                comments: t.game.comments,
                remixes: t.game.remixes,
                genre: game.genre ? genreLabel(t, game.genre) : undefined,
              }}
            />
          </Link>
        ))}
      </div>
      {isFetchingNextPage && (
        <div className="fp-game-grid">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="aspect-[16/12] w-full rounded-2xl" />
          ))}
        </div>
      )}
      <div ref={sentinelRef} aria-hidden />
    </>
  );
}
