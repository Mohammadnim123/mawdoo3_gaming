"use client";

import Link from "next/link";
import { useMemo, useState, type ReactElement } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Bookmark, Gamepad2, Heart, MessageCircle, Share2, Shuffle } from "lucide-react";
import type { MyGame } from "@codply/contracts";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Skeleton,
  StatPill,
  type BadgeTone,
} from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";

const PAGE_SIZE = 30;

/** Known publish states → badge tone; unknown wire states render neutral. */
const STATUS_TONES: Record<string, BadgeTone> = {
  live: "success",
  draft: "warning",
  failed: "danger",
};

/** Games tab (E36): every game (drafts included) as an analytics row. */
export function MyGamesPanel(): ReactElement {
  const { t } = useI18n();
  const [analyticsGame, setAnalyticsGame] = useState<MyGame | null>(null);
  const gameStatusLabels: Record<string, string> = t.dashboard.gameStatuses;

  const query = useInfiniteQuery({
    queryKey: ["creator-my-games"],
    queryFn: ({ pageParam }) =>
      getServices().games.myGames({ cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[5.5rem] w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <EmptyState
        icon={Gamepad2}
        title={t.account.gamesErrorTitle}
        description={t.account.gamesErrorDescription}
        action={
          <Button variant="soft" onClick={() => void query.refetch()}>
            {t.common.retry}
          </Button>
        }
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Gamepad2}
        title={t.dashboard.noGamesTitle}
        description={t.dashboard.noGamesDescription}
        action={
          <Link href="/create">
            <Button variant="gradient-cta">{t.dashboard.createGame}</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {items.map((game) => (
          <li
            key={game.id}
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-edge bg-surface-1 p-3"
          >
            {game.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- tiny CDN cover thumb
              <img
                src={game.cover_url}
                alt=""
                className="h-16 w-28 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                <Gamepad2 className="size-6 text-ink-muted" aria-hidden />
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-ink">{game.title}</p>
                <Badge tone={STATUS_TONES[game.status] ?? "neutral"}>
                  {gameStatusLabels[game.status] ?? game.status}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <StatPill icon={Gamepad2} value={game.play_count} label={t.dashboard.stats.plays} />
                <StatPill icon={Heart} value={game.like_count} label={t.dashboard.stats.likes} />
                <StatPill
                  icon={Shuffle}
                  value={game.remix_count}
                  label={t.dashboard.stats.remixes}
                />
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setAnalyticsGame(game)}>
              {t.dashboard.viewAnalytics}
            </Button>
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
          {t.common.loadMore}
        </Button>
      )}

      <GameAnalyticsDialog game={analyticsGame} onClose={() => setAnalyticsGame(null)} />
    </div>
  );
}

/** Per-game engagement breakdown — every count the owner row already carries. */
function GameAnalyticsDialog({
  game,
  onClose,
}: {
  game: MyGame | null;
  onClose: () => void;
}): ReactElement | null {
  const { t } = useI18n();
  if (!game) return null;
  const rows = [
    { icon: Gamepad2, label: t.dashboard.stats.plays, value: game.play_count },
    { icon: Heart, label: t.dashboard.stats.likes, value: game.like_count },
    { icon: MessageCircle, label: t.dashboard.stats.comments, value: game.comment_count },
    { icon: Bookmark, label: t.dashboard.stats.saves, value: game.save_count },
    { icon: Share2, label: t.dashboard.stats.shares, value: game.share_count },
    { icon: Shuffle, label: t.dashboard.stats.remixes, value: game.remix_count },
  ];
  return (
    <Dialog open onClose={onClose} title={game.title} closeLabel={t.ui.closeDialog}>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li
            key={row.label}
            className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-surface-2 px-3 py-2"
          >
            <span className="text-sm text-ink-secondary">{row.label}</span>
            <StatPill icon={row.icon} value={row.value} label={row.label} />
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
