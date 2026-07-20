"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Heart,
  MessageCircle,
  Share2,
  X,
} from "lucide-react";
import type { GameDetail } from "@codply/contracts";
import { normalizeOrigin } from "@codply/game-runtime";
import { Avatar, IconButton, Skeleton, cn, useToast } from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useLikeToggle, useSaveToggle, useShare } from "@/domain/hooks/useSocial";
import { neighbors, useFeedNav } from "@/stores/feedNav";
import { GamePlayerFrame } from "@/components/game/GamePlayerFrame";
import { RemixButton } from "@/components/game/RemixButton";
import { FollowButton } from "@/components/social/FollowButton";
import { CommentsSheet } from "@/components/social/CommentsSheet";
import { RelativeTime } from "@/components/comments";

/**
 * TikTok-style full-screen player (E16-F7): the game plays immediately, in
 * place; ↑/↓ (keys, buttons, swipe) moves through the feed you were browsing;
 * the action bar carries like/comment/save/share/remix; Esc/✕ returns to the
 * exact feed position. Islands adaptation of the reference's intercepted
 * `@overlay/(.)g/[slug]` route: the feed island renders this over the feed
 * when the URL soft-navigates to /g/{slug} — hard loads get the full game
 * page instead (Django serves it).
 */
export function PlayerOverlay({ slug }: { slug: string }): ReactElement {
  const { t, f } = useI18n();
  const router = useRouter();
  const { slugs, loadMore } = useFeedNav();
  const [commentsOpen, setCommentsOpen] = useState(false);

  const gameQuery = useQuery({
    queryKey: ["overlay-game", slug],
    queryFn: () => getServices().games.gameBySlug(slug),
  });
  const game = gameQuery.data;

  const { prev, next } = useMemo(() => neighbors(slugs, slug), [slugs, slug]);

  // Nearing the end of the captured feed → pull the next page in.
  useEffect(() => {
    if (next === null && slugs.length > 0 && loadMore) loadMore();
  }, [next, slugs.length, loadMore]);

  const goTo = (target: string | null): void => {
    // Reference: router.replace(`/g/${target}`, { scroll: false }) — a soft
    // in-place URL swap. The islands' next/navigation shim maps replace() to
    // a full page load (Django owns cross-page routing), so swap the history
    // entry directly; the shim's patched replaceState notifies usePathname
    // subscribers and the feed island re-renders this overlay with the new
    // slug. One history entry total — close() still pops back to the feed.
    if (target) window.history.replaceState(window.history.state, "", `/g/${target}`);
  };
  const close = (): void => router.back();

  // Keyboard: ↑/↓ navigate, Esc closes (unless the comments sheet is open —
  // the Dialog owns Esc there).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (commentsOpen) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "Escape") close();
      if (event.key === "ArrowUp") {
        event.preventDefault();
        goTo(prev);
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        goTo(next);
      }
    };
    // Capture phase: the player chrome stops bubble-phase propagation, and a
    // truly game-captured keyboard (focus inside the sandboxed iframe) never
    // reaches this window at all — gameplay keys stay unaffected.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prev, next, commentsOpen]);

  // The page behind must not scroll while the overlay is up.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Own the keyboard on open: focus starts on the overlay (not the game's
  // iframe), so ↑/↓/Esc drive the feed until the player clicks into the game.
  // Many games call focus() on load from inside the sandbox — that silent
  // steal is reverted until the user has actually pointed at the game
  // (a real click still hands the keyboard over, GamePlayer's capture UX).
  const containerRef = useRef<HTMLDivElement>(null);
  const userTouchedGame = useRef(false);
  useEffect(() => {
    userTouchedGame.current = false;
    containerRef.current?.focus();
    const onPointerDown = (event: PointerEvent): void => {
      if ((event.target as HTMLElement | null)?.closest("iframe, [data-game-surface]")) {
        userTouchedGame.current = true;
      }
    };
    const onWindowBlur = (): void => {
      requestAnimationFrame(() => {
        if (!userTouchedGame.current && document.activeElement?.tagName === "IFRAME") {
          containerRef.current?.focus();
        }
      });
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [slug]);

  // Touch swipe: vertical flick ≥ 60px moves through the feed.
  const [touchStartY, setTouchStartY] = useState<number | null>(null);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-[45] flex flex-col bg-canvas outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={game ? f.msg(t.overlay.playing, { title: game.title }) : t.overlay.gamePlayer}
      onTouchStart={(e) => setTouchStartY(e.touches[0]?.clientY ?? null)}
      onTouchEnd={(e) => {
        const endY = e.changedTouches[0]?.clientY;
        if (touchStartY === null || endY === undefined) return;
        const delta = endY - touchStartY;
        if (delta <= -60) goTo(next);
        if (delta >= 60) goTo(prev);
        setTouchStartY(null);
      }}
    >
      <div className="absolute end-3 top-3 z-10">
        <IconButton icon={X} aria-label={t.overlay.closePlayer} variant="solid" onClick={close} />
      </div>

      {/* Feed navigation — end edge, vertically centered (hidden without context). */}
      {(prev !== null || next !== null) && (
        <div className="absolute end-3 top-1/2 z-10 hidden -translate-y-1/2 flex-col gap-2 sm:flex">
          <IconButton
            icon={ArrowUp}
            aria-label={t.overlay.previousGame}
            variant="solid"
            disabled={prev === null}
            onClick={() => goTo(prev)}
          />
          <IconButton
            icon={ArrowDown}
            aria-label={t.overlay.nextGame}
            variant="solid"
            disabled={next === null}
            onClick={() => goTo(next)}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1 items-center justify-center px-2 pt-2 sm:px-14">
        {gameQuery.isPending && <Skeleton className="aspect-[16/10] w-full max-w-3xl rounded-2xl" />}
        {gameQuery.isError && (
          <p className="text-sm text-ink-secondary">
            {t.overlay.flickeredOut}{" "}
            <button type="button" onClick={close} className="font-medium text-violet">
              {t.overlay.backToFeed}
            </button>
          </p>
        )}
        {game && game.current_version && (
          <div data-game-surface className="w-full max-w-3xl">
            <GamePlayerFrame
              key={game.id}
              gameId={game.id}
              playUrl={game.current_version.play_url}
              cdnOrigin={normalizeOrigin(game.current_version.play_url) ?? ""}
              title={game.title}
              playSource="feed"
            />
          </div>
        )}
        {game && !game.current_version && (
          <p className="text-sm text-ink-secondary">{t.overlay.noPublishedVersion}</p>
        )}
      </div>

      {game && (
        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-edge-subtle px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link href={`/u/${game.owner.handle}`} className="shrink-0">
              <Avatar
                name={game.owner.display_name ?? game.owner.handle}
                src={game.owner.avatar_url ?? undefined}
                size="md"
              />
            </Link>
            <div className="flex min-w-0 flex-col">
              <Link
                href={`/g/${game.slug}`}
                className="truncate font-display text-sm font-semibold text-ink hover:text-violet"
              >
                {game.title}
              </Link>
              <p className="truncate text-xs text-ink-muted">
                <Link href={`/u/${game.owner.handle}`} className="hover:text-ink" dir="ltr">
                  @{game.owner.handle}
                </Link>{" "}
                · <RelativeTime iso={game.created_at} />
              </p>
            </div>
            <FollowButton handle={game.owner.handle} />
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <OverlayActions game={game} onComments={() => setCommentsOpen(true)} />
            <RemixButton
              game={game}
              onRemixed={(jobId) => {
                router.push(jobId ? `/create?job=${encodeURIComponent(jobId)}` : "/me");
              }}
            />
          </div>
        </footer>
      )}

      {game && (
        <CommentsSheet
          open={commentsOpen}
          onClose={() => setCommentsOpen(false)}
          gameId={game.id}
          ownerHandle={game.owner.handle}
          commentCount={game.comment_count}
        />
      )}
    </div>
  );
}

/** Like / comments / save / share pills with live counts. */
export function OverlayActions({
  game,
  onComments,
}: {
  game: GameDetail;
  onComments: () => void;
}): ReactElement {
  const { t } = useI18n();
  const { toast } = useToast();
  const { liked, toggle: toggleLike } = useLikeToggle(game);
  const { saved, toggle: toggleSave } = useSaveToggle(game);
  const share = useShare();

  return (
    <>
      <EngagementPill
        icon={<Share2 className="size-4" aria-hidden />}
        count={game.share_count}
        label={t.post.share}
        onClick={() => {
          void share(game).then((outcome) => {
            if (outcome === "copied") toast({ title: t.common.linkCopied, variant: "success" });
          });
        }}
      />
      <EngagementPill
        icon={
          <Bookmark className={cn("size-4", saved && "fill-current text-warning")} aria-hidden />
        }
        count={game.save_count}
        label={saved ? t.overlay.saved : t.post.save}
        active={saved}
        onClick={toggleSave}
      />
      <EngagementPill
        icon={<MessageCircle className="size-4" aria-hidden />}
        count={game.comment_count}
        label={t.overlay.comments}
        onClick={onComments}
      />
      <EngagementPill
        icon={<Heart className={cn("size-4", liked && "fill-current text-danger")} aria-hidden />}
        count={game.like_count}
        label={liked ? t.overlay.unlike : t.post.like}
        active={liked}
        onClick={toggleLike}
      />
    </>
  );
}

function EngagementPill({
  icon,
  count,
  label,
  active = false,
  onClick,
}: {
  icon: ReactElement;
  count: number;
  label: string;
  active?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold",
        "transition-colors duration-150 ease-out",
        active
          ? "border-edge-strong bg-surface-3 text-ink"
          : "border-edge bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink",
      )}
    >
      {icon}
      <span aria-hidden>{formatCount(count)}</span>
    </button>
  );
}

/** 1234 → "1.2k", 1200000 → "1.2m". */
export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${trimZero((value / 1_000_000).toFixed(1))}m`;
  if (value >= 1_000) return `${trimZero((value / 1_000).toFixed(1))}k`;
  return String(value);
}

function trimZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}
