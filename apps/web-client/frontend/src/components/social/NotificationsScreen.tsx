"use client";

import Link from "next/link";
import { useEffect, useMemo, type ReactElement } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff } from "lucide-react";
import type { Notification } from "@codply/contracts";
import { Avatar, Button, EmptyState, Skeleton, cn } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { RelativeTime } from "@/components/comments";

const PAGE_SIZE = 30;

/**
 * The inbox (E16-F5). Opening it marks everything read (the badge resets);
 * unread rows stay visually highlighted until you leave.
 */
export function NotificationsScreen(): ReactElement {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: ["notifications"],
    queryFn: ({ pageParam }) =>
      getServices().social.notifications({ cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  // Opening the inbox clears the badge — the highlight in THIS render sticks.
  useEffect(() => {
    getServices()
      .social.markNotificationsRead()
      .then(() => queryClient.invalidateQueries({ queryKey: ["unread-count"] }))
      .catch(() => {
        // best-effort; the badge refreshes on its own interval
      });
  }, [queryClient]);

  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-5 sm:py-8">
      <h1 className="fp-title-page flex items-center gap-2 font-[family-name:var(--font-space-grotesk)] font-bold">
        <Bell className="size-6 text-violet" aria-hidden />
        {t.notifications.title}
      </h1>

      {query.isPending && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {query.isSuccess && items.length === 0 && (
        <EmptyState
          icon={BellOff}
          title={t.notifications.empty}
          description={t.notifications.emptyDescription}
        />
      )}

      <ul className="flex flex-col gap-1.5">
        {items.map((notification) => (
          <li key={notification.id}>
            <NotificationRow notification={notification} />
          </li>
        ))}
      </ul>

      {query.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t.notifications.loadOlder}
        </Button>
      )}
    </div>
  );
}

function NotificationRow({ notification }: { notification: Notification }): ReactElement {
  const { t } = useI18n();
  const verbs: Record<Notification["type"], string> = t.notifications.verbs;
  const actorName =
    notification.actor.display_name ?? notification.actor.handle ?? t.common.someone;
  const href =
    notification.type === "follow"
      ? `/u/${notification.actor.handle ?? ""}`
      : notification.game
        ? `/g/${notification.game.slug}`
        : `/u/${notification.actor.handle ?? ""}`;

  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-3 py-2.5 transition-colors duration-150 ease-out",
        notification.read
          ? "border-transparent hover:bg-surface-1"
          : "border-edge bg-surface-1 hover:bg-surface-2",
      )}
    >
      <Avatar
        name={actorName}
        src={notification.actor.avatar_url ?? undefined}
        size="sm"
        className="mt-0.5 shrink-0"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm text-ink">
          <span className="font-semibold">{actorName}</span>{" "}
          {verbs[notification.type]}
          {notification.type !== "follow" && notification.game && (
            <>
              {" "}
              <span className="font-medium text-ink-secondary">{notification.game.title}</span>
            </>
          )}
        </span>
        {notification.comment_excerpt && (
          <span className="truncate text-xs text-ink-muted">
            &ldquo;{notification.comment_excerpt}&rdquo;
          </span>
        )}
        <span className="text-xs text-ink-muted">
          <RelativeTime iso={notification.created_at} />
        </span>
      </span>
      {notification.game?.cover_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={notification.game.cover_url}
          alt=""
          className="h-10 w-16 shrink-0 rounded-lg border border-edge-subtle object-cover"
        />
      )}
    </Link>
  );
}
