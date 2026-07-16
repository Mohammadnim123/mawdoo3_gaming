"use client";

import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Bookmark,
  Gamepad2,
  Home,
  Sparkle,
  TrendingUp,
  UsersRound,
  Wand2,
} from "lucide-react";
import type { FeedSort } from "@codply/contracts";
import { Avatar, cn } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMe } from "@/domain/hooks/useMe";
import { useRequireAuth, useUnreadCount } from "@/domain/hooks/useSocial";
import { FollowButton } from "@/components/social/FollowButton";

/**
 * The home rails (E21): FB-style left navigation + right discovery rail.
 * Pure presentational composition — the center column owns feed state and
 * hands the left rail its sort controls.
 */

// ── left: identity + navigation ────────────────────────────────────────────

export function LeftRail({
  sort,
  onPickSort,
}: {
  sort: FeedSort;
  onPickSort: (sort: FeedSort) => void;
}): ReactElement {
  const { t } = useI18n();
  const { data: me } = useMe();
  const unread = useUnreadCount();
  return (
    <nav className="flex flex-col gap-1" aria-label={t.feed.feedNavigation}>
      {me ? (
        <Link
          href={`/u/${me.handle}`}
          className="mb-2 flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-surface-1"
        >
          <Avatar name={me.display_name || me.handle} src={me.avatar_url ?? undefined} size="md" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">
              {me.display_name || me.handle}
            </span>
            <span className="block truncate text-xs text-ink-muted" dir="ltr">
              @{me.handle}
            </span>
          </span>
        </Link>
      ) : (
        <Link
          href="/login"
          className="mb-2 rounded-xl border border-edge bg-surface-1 px-3 py-2.5 text-center text-sm font-medium text-ink"
        >
          {t.feed.signInToPost}
        </Link>
      )}

      {/* E41: Home IS the personalized for_you feed; trending gets its own tab. */}
      <RailButton
        icon={<Home className="size-5" aria-hidden />}
        label={t.nav.home}
        active={sort === "for_you"}
        onClick={() => onPickSort("for_you")}
      />
      <RailButton
        icon={<TrendingUp className="size-5" aria-hidden />}
        label={t.feed.trending}
        active={sort === "trending"}
        onClick={() => onPickSort("trending")}
      />
      <RailButton
        icon={<Sparkle className="size-5" aria-hidden />}
        label={t.feed.new}
        active={sort === "new"}
        onClick={() => onPickSort("new")}
      />
      <RailButton
        icon={<UsersRound className="size-5" aria-hidden />}
        label={t.feed.following}
        active={sort === "following"}
        onClick={() => onPickSort("following")}
      />
      <RailLink icon={<Wand2 className="size-5" aria-hidden />} label={t.feed.createAGame} href="/create" />
      <RailLink icon={<Gamepad2 className="size-5" aria-hidden />} label={t.feed.myGames} href="/me" />
      <RailLink icon={<Bookmark className="size-5" aria-hidden />} label={t.feed.saved} href="/me?tab=saves" />
      <RailLink
        icon={<Bell className="size-5" aria-hidden />}
        label={t.feed.notifications}
        href="/notifications"
        badge={unread > 0 ? unread : undefined}
      />
    </nav>
  );
}

function railClass(active: boolean): string {
  return cn(
    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
    "transition-colors duration-150 ease-out",
    active ? "bg-surface-1 text-ink" : "text-ink-secondary hover:bg-surface-1 hover:text-ink",
  );
}

function RailButton({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button type="button" onClick={onClick} className={railClass(active)} aria-pressed={active}>
      {icon}
      {label}
    </button>
  );
}

function RailLink({
  icon,
  label,
  href,
  badge,
}: {
  icon: ReactNode;
  label: string;
  href: string;
  badge?: number;
}): ReactElement {
  return (
    <Link href={href} className={railClass(false)}>
      {icon}
      <span className="flex-1">{label}</span>
      {badge !== undefined && (
        <span className="rounded-full bg-violet px-2 py-0.5 text-xs font-semibold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

// ── right: trending now + who to follow ────────────────────────────────────

export function RightRail(): ReactElement {
  const { t } = useI18n();
  return (
    <aside className="flex flex-col gap-4" aria-label={t.feed.discovery}>
      <TrendingNow />
      <WhoToFollow />
    </aside>
  );
}

function RailCard({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="rounded-2xl border border-edge bg-surface-1 p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function TrendingNow(): ReactElement | null {
  const { t, f } = useI18n();
  const trending = useQuery({
    queryKey: ["feed-rail-trending"],
    queryFn: () => getServices().games.feed({ sort: "trending", limit: 5 }),
    staleTime: 60_000,
  });
  const items = trending.data?.items ?? [];
  if (trending.isSuccess && items.length === 0) return null;
  return (
    <RailCard title={t.feed.trendingNow}>
      <ol className="flex flex-col gap-2.5">
        {items.map((game, index) => (
          <li key={game.id}>
            <Link
              href={`/g/${game.slug}`}
              scroll={false}
              className="group flex items-center gap-3"
            >
              <span className="w-4 text-center text-sm font-bold text-ink-muted">{index + 1}</span>
              {game.cover_url ? (
                <img
                  src={game.cover_url}
                  alt=""
                  loading="lazy"
                  className="h-9 w-14 shrink-0 rounded-lg border border-edge object-cover"
                />
              ) : (
                <span className="flex h-9 w-14 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface-2">
                  <Gamepad2 className="size-4 text-ink-muted" aria-hidden />
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink group-hover:underline">
                  {game.title}
                </span>
                <span className="block flex items-center gap-1 truncate text-xs text-ink-muted">
                  <TrendingUp className="size-3" aria-hidden />
                  {f.msg(t.feed.plays, { count: game.play_count })}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </RailCard>
  );
}

function WhoToFollow(): ReactElement | null {
  const { t, f } = useI18n();
  const { data: me } = useMe();
  const { gate } = useRequireAuth();
  const suggested = useQuery({
    queryKey: ["suggested-creators", me?.handle ?? null],
    queryFn: () => getServices().social.suggestedCreators(4),
    staleTime: 120_000,
  });
  const creators = (suggested.data ?? []).filter((c) => c.handle !== me?.handle);
  if (creators.length === 0) return null;
  return (
    <RailCard title={t.feed.whoToFollow}>
      <ul className="flex flex-col gap-3">
        {creators.map((creator) => (
          <li key={creator.handle} className="flex items-center gap-3">
            <Link href={`/u/${creator.handle}`} className="shrink-0">
              <Avatar
                name={creator.display_name || creator.handle}
                src={creator.avatar_url ?? undefined}
                size="sm"
              />
            </Link>
            <Link href={`/u/${creator.handle}`} className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink hover:underline">
                {creator.display_name || creator.handle}
              </span>
              <span className="block truncate text-xs text-ink-muted">
                {f.plural(t.feed.followers, creator.follower_count)}
              </span>
            </Link>
            {me ? (
              <FollowButton handle={creator.handle} following={false} size="sm" />
            ) : (
              <button
                type="button"
                onClick={() => gate()}
                className="rounded-full border border-edge px-3 py-1 text-xs font-medium text-ink-secondary hover:text-ink"
              >
                {t.feed.follow}
              </button>
            )}
          </li>
        ))}
      </ul>
    </RailCard>
  );
}
