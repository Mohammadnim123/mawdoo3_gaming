"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  Ghost,
  UserRoundCheck,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import type { ConnectionUser, PaginatedResponse } from "@codply/contracts";
import { ApiError } from "@codply/contracts";
import {
  Avatar,
  Button,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMe } from "@/domain/hooks/useMe";
import { useFollowToggle } from "@/domain/hooks/useSocial";

const PAGE_SIZE = 24;

type ConnectionsTab = "followers" | "following";

/**
 * The dedicated Following/Followers page (`/u/{handle}/followers|following`).
 * Header identifies whose connections these are; two tabs list the people who
 * follow the creator and the people the creator follows. Each row links to the
 * creator's profile and carries a live follow/unfollow button.
 *
 * The active tab IS the URL: switching tabs pushes `/u/{handle}/{tab}` (same
 * document, via the next/navigation shim) so back/forward walk the tabs and
 * the two lists stay independently shareable — like the profile grid and the
 * search page do.
 */
export function ConnectionsScreen({
  handle,
  initialTab = "followers",
}: {
  handle: string;
  initialTab?: ConnectionsTab;
}): ReactElement {
  const { t, f } = useI18n();
  const { data: me } = useMe();
  const isSelf = me?.handle === handle;

  // The active tab is LOCAL state (seeded from the server-resolved route), like
  // every other tabbed screen here (e.g. ProfileScreen). A click flips it
  // synchronously — the panel mounts and its query fires immediately — so tab
  // activation never depends on the history-shim's pushState→re-render loop
  // (unreliable on this two-island page, and the cause of the "needs a refresh"
  // bug). The URL is a cosmetic mirror for deep-linking + back/forward only.
  const [tab, setTab] = useState<ConnectionsTab>(initialTab);
  const pathname = usePathname();

  // Reconcile with external URL changes (browser back/forward) — a no-op for
  // our own clicks, which already set the tab before pushing the URL.
  useEffect(() => {
    const fromPath: ConnectionsTab | null = pathname.endsWith("/followers")
      ? "followers"
      : pathname.endsWith("/following")
        ? "following"
        : null;
    if (fromPath && fromPath !== tab) setTab(fromPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const selectTab = (next: string): void => {
    const target: ConnectionsTab = next === "following" ? "following" : "followers";
    if (target === tab) return;
    setTab(target); // instant, local — activates the panel + fires its query
    window.history.pushState(null, "", `/u/${handle}/${target}`); // cosmetic URL sync
  };

  const profileQuery = useQuery({
    queryKey: ["profile", handle],
    queryFn: () => getServices().social.profile(handle),
    staleTime: 60_000,
    retry: (count, error) =>
      !(ApiError.isApiError(error) && error.code === "not_found") && count < 2,
  });
  const name = profileQuery.data?.user.display_name || profileQuery.data?.user.handle || handle;

  const title = isSelf
    ? tab === "followers"
      ? t.connections.myFollowersTitle
      : t.connections.myFollowingTitle
    : tab === "followers"
      ? t.connections.followersTitle
      : t.connections.followingTitle;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-5 sm:py-8">
      <header className="flex flex-col gap-4">
        <Link
          href={`/u/${handle}`}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-secondary transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
          {t.connections.backToProfile}
        </Link>
        <div className="flex items-center gap-3">
          <Link href={`/u/${handle}`} className="shrink-0">
            <Avatar name={name} src={profileQuery.data?.user.avatar_url ?? undefined} size="lg" />
          </Link>
          <div className="flex min-w-0 flex-col">
            <h1 className="fp-title-page font-[family-name:var(--font-space-grotesk)] font-bold">
              {f.msg(title, { name })}
            </h1>
            <span className="truncate text-sm text-ink-muted" dir="ltr">
              @{handle}
            </span>
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList aria-label={t.connections.tabs}>
          <TabsTrigger value="followers" icon={UsersRound}>
            {t.connections.tabFollowers}
          </TabsTrigger>
          <TabsTrigger value="following" icon={UserRoundCheck}>
            {t.connections.tabFollowing}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="followers" className="pt-4">
          <ConnectionsList
            queryKey={["connections", handle, "followers"]}
            fetcher={(cursor) =>
              getServices().social.followers(handle, { cursor, limit: PAGE_SIZE })
            }
            emptyTitle={t.connections.followersEmptyTitle}
            emptyDescription={
              isSelf
                ? t.connections.followersEmptyDescriptionSelf
                : f.msg(t.connections.followersEmptyDescription, { name })
            }
            showDiscover={isSelf}
          />
        </TabsContent>

        <TabsContent value="following" className="pt-4">
          <ConnectionsList
            queryKey={["connections", handle, "following"]}
            fetcher={(cursor) =>
              getServices().social.following(handle, { cursor, limit: PAGE_SIZE })
            }
            emptyTitle={t.connections.followingEmptyTitle}
            emptyDescription={
              isSelf
                ? t.connections.followingEmptyDescriptionSelf
                : f.msg(t.connections.followingEmptyDescription, { name })
            }
            showDiscover={isSelf}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** One tab's infinite list of people (followers or following). */
function ConnectionsList({
  queryKey,
  fetcher,
  emptyTitle,
  emptyDescription,
  showDiscover,
}: {
  queryKey: readonly string[];
  fetcher: (cursor?: string) => Promise<PaginatedResponse<ConnectionUser>>;
  emptyTitle: string;
  emptyDescription: string;
  showDiscover: boolean;
}): ReactElement {
  const { t } = useI18n();
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetcher(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const users = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  const sentinelRef = useRef<HTMLDivElement>(null);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
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
    return <RowSkeletons count={6} />;
  }

  if (query.isError) {
    return (
      <EmptyState
        icon={Ghost}
        title={t.connections.errorTitle}
        description={t.connections.errorDescription}
        action={
          <Button variant="soft" onClick={() => void query.refetch()}>
            {t.common.retry}
          </Button>
        }
      />
    );
  }

  if (users.length === 0) {
    return (
      <EmptyState
        icon={UsersRound}
        title={emptyTitle}
        description={emptyDescription}
        action={
          showDiscover ? (
            <Link href="/">
              <Button variant="soft">{t.connections.discoverCreators}</Button>
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-1">
        {users.map((user) => (
          <ConnectionRow key={user.handle} user={user} />
        ))}
      </ul>
      {isFetchingNextPage && <RowSkeletons count={3} className="mt-1" />}
      <div ref={sentinelRef} aria-hidden />
    </>
  );
}

function RowSkeletons({ count, className }: { count: number; className?: string }): ReactElement {
  return (
    <ul className={`flex flex-col gap-1${className ? ` ${className}` : ""}`}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center gap-3 rounded-xl p-2">
          <Skeleton className="size-12 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-32 rounded" />
            <Skeleton className="h-3 w-24 rounded" />
          </div>
          <Skeleton className="h-8 w-24 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

/** A single person: avatar + name/@handle + bio, and a follow/unfollow button. */
function ConnectionRow({ user }: { user: ConnectionUser }): ReactElement {
  const { t, f } = useI18n();
  const name = user.display_name || user.handle;
  return (
    <li className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-surface-1">
      <Link href={`/u/${user.handle}`} className="shrink-0">
        <Avatar name={name} src={user.avatar_url ?? undefined} size="lg" />
      </Link>
      <Link href={`/u/${user.handle}`} className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-ink hover:underline">{name}</span>
        <span className="truncate text-xs text-ink-muted" dir="ltr">
          @{user.handle}
        </span>
        {user.bio ? (
          <span className="truncate text-xs text-ink-secondary">{user.bio}</span>
        ) : (
          <span className="truncate text-xs text-ink-muted">
            {f.plural(t.connections.followerCount, user.follower_count)}
          </span>
        )}
      </Link>
      <RowFollowButton handle={user.handle} initialFollowing={user.viewer?.following ?? false} />
    </li>
  );
}

/**
 * Row follow button. Reuses the app's follow mutation (optimistic profile-cache
 * patch + anonymous gate) but keeps the label reactive with local state, since
 * the list rows are handed a known follow-state rather than resolving one from
 * the profile cache (which would cost a fetch per row).
 */
function RowFollowButton({
  handle,
  initialFollowing,
}: {
  handle: string;
  initialFollowing: boolean;
}): ReactElement | null {
  const { t } = useI18n();
  const { data: me } = useMe();
  const [following, setFollowing] = useState(initialFollowing);
  const { toggle } = useFollowToggle(handle, following);

  // Re-seed if the server hands this handle a fresh state (list refetch).
  useEffect(() => {
    setFollowing(initialFollowing);
  }, [initialFollowing]);

  if (me?.handle === handle) return null;

  const onClick = (): void => {
    // useFollowToggle gates anonymous users to /login without mutating — only
    // flip the local label once we know a real toggle will fire.
    if (me) setFollowing((current) => !current);
    toggle();
  };

  return (
    <Button
      variant={following ? "soft" : "solid"}
      size="sm"
      onClick={onClick}
      className="shrink-0"
      leftIcon={
        following ? (
          <UserRoundCheck className="size-4" aria-hidden />
        ) : (
          <UserRoundPlus className="size-4" aria-hidden />
        )
      }
    >
      {following ? t.profile.following : t.profile.follow}
    </Button>
  );
}
