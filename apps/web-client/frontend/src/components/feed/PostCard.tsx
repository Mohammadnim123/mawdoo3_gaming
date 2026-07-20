"use client";

import Link from "next/link";
import Image from "next/image";
import { useRef, useState, type ReactElement, type RefObject } from "react";
import { Bookmark, Gamepad2, Heart, MessageCircle, Play, Share2 } from "lucide-react";
import type { FeedItem } from "@codply/contracts";
import { Avatar, Chip, cn, genreMeta, resolveIcon } from "@codply/ui";
import { genreLabel } from "@/domain/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useComments } from "@/domain/hooks/useComments";
import { useLikeToggle, useSaveToggle, useShare } from "@/domain/hooks/useSocial";
import { CommentComposer } from "@/components/comments/CommentComposer";
import { CommentList } from "@/components/comments/CommentList";

/**
 * The feed POST (E21): one game as a social post — author header, caption,
 * playable media, action bar, inline comment previews + an expandable comment
 * thread. Pure composition: each section is its own component; the card only
 * arranges. The Comment action expands the thread and focuses the composer —
 * it never opens the player (only the cover/Play does).
 */
export function PostCard({ game }: { game: FeedItem }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  // The composer is always mounted, so its ref is live before expansion — the
  // Comment button can focus it synchronously without opening the player.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const openComments = (): void => {
    setExpanded(true);
    composerRef.current?.focus();
  };

  return (
    <article
      className="flex flex-col rounded-2xl border border-edge bg-surface-1"
      data-testid="post-card"
      data-game-id={game.id}
    >
      <PostHeader game={game} />
      {game.description && <PostCaption text={game.description} />}
      <PostMedia game={game} />
      <PostActions game={game} onComment={openComments} />
      <PostComments
        game={game}
        expanded={expanded}
        onExpand={() => setExpanded(true)}
        composerRef={composerRef}
      />
    </article>
  );
}

// ── header: avatar · author · time · genre ────────────────────────────────

function PostHeader({ game }: { game: FeedItem }): ReactElement {
  const { f } = useI18n();
  const author = game.owner.display_name || game.owner.handle;
  // E41: date the post by its TRUE post time (published_at). created_at is the
  // draft-START time — a game drafted days ago but posted today must read
  // "today". Legacy rows with no publish stamp fall back to created_at.
  const postedAt = game.published_at ?? game.created_at;
  return (
    <header className="flex items-center gap-3 px-4 pt-3">
      <Link href={`/u/${game.owner.handle}`} className="shrink-0">
        <Avatar name={author} src={game.owner.avatar_url ?? undefined} size="md" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          href={`/u/${game.owner.handle}`}
          className="block truncate text-sm font-semibold text-ink hover:underline"
        >
          {author}
        </Link>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
          <span dir="ltr" className="truncate">
            @{game.owner.handle}
          </span>
          <span aria-hidden className="shrink-0">
            ·
          </span>
          <time dateTime={postedAt} className="shrink-0">
            {f.timeAgo(postedAt)}
          </time>
        </p>
      </div>
      {game.genre !== null && <PostGenreChip genre={game.genre} />}
    </header>
  );
}

/** Genre chip — hidden when genre is null (viewer's own unpublished drafts).
 * Width-capped + truncated so a long tag never squeezes the author name on
 * mobile (scales with the viewport, opens up on ≥sm). */
function PostGenreChip({ genre }: { genre: string }): ReactElement {
  const { t } = useI18n();
  const meta = genreMeta(genre);
  const Icon = resolveIcon(meta.icon);
  return (
    <Chip
      accent={meta.hue}
      leading={<Icon className="size-3.5 shrink-0" aria-hidden />}
      className="min-w-0 max-w-[42vw] shrink-0 sm:max-w-[15rem]"
    >
      <span className="truncate">{genreLabel(t, genre)}</span>
    </Chip>
  );
}

// ── caption: the creator's words, clamped with expand ─────────────────────

function PostCaption({ text }: { text: string }): ReactElement {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 180;
  return (
    <div className="px-4 pt-2">
      <p
        className={cn(
          "whitespace-pre-wrap break-words text-sm leading-relaxed text-ink",
          !expanded && long && "line-clamp-3",
        )}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-xs font-medium text-ink-muted hover:text-ink"
        >
          {expanded ? t.post.less : t.post.more}
        </button>
      )}
    </div>
  );
}

// ── media: cover + play → the full-screen overlay (feed nav preserved) ────

function PostMedia({ game }: { game: FeedItem }): ReactElement {
  const { t, f } = useI18n();
  return (
    <Link
      href={`/g/${game.slug}`}
      scroll={false}
      className="group relative mt-3 block overflow-hidden border-y border-edge-subtle bg-surface-2"
      aria-label={f.msg(t.post.playGame, { title: game.title })}
    >
      {game.cover_url ? (
        // E30 covers are full-size PNG posters; the shimmed next/image renders
        // a plain <img> here (Django serves no image optimizer) — the CDN
        // variant is already feed-sized.
        <Image
          src={game.cover_url}
          alt={game.title}
          width={1024}
          height={576}
          sizes="(max-width: 640px) 100vw, 560px"
          className="aspect-video w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02]"
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center">
          <Gamepad2 className="size-12 text-ink-muted" aria-hidden />
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-150 group-hover:bg-black/20">
        <span
          className={cn(
            "flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-sm font-semibold text-white",
            "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
        >
          <Play className="size-4 fill-current" aria-hidden />
          {t.post.playAction}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-2.5 pt-8">
        <p className="truncate text-base font-bold text-white">{game.title}</p>
      </div>
    </Link>
  );
}

// ── actions: like · comment · save · share, with live counts ──────────────

function PostActions({
  game,
  onComment,
}: {
  game: FeedItem;
  onComment: () => void;
}): ReactElement {
  const { t, f } = useI18n();
  const { liked, toggle: toggleLike } = useLikeToggle(game);
  const { saved, toggle: toggleSave } = useSaveToggle(game);
  const share = useShare();

  const stats = [
    game.like_count > 0 && f.plural(t.post.likes, game.like_count),
    game.play_count > 0 && f.plural(t.post.plays, game.play_count),
    game.remix_count > 0 && f.plural(t.post.remixes, game.remix_count),
  ].filter(Boolean);

  return (
    <div className="px-4">
      {stats.length > 0 && (
        <p className="border-b border-edge-subtle py-2 text-xs text-ink-muted">
          {stats.join(" · ")}
        </p>
      )}
      <div className="grid grid-cols-4 py-1" role="group" aria-label={t.post.actions}>
        <ActionButton
          icon={<Heart className={cn("size-4", liked && "fill-current")} aria-hidden />}
          label={t.post.like}
          active={liked}
          activeClass="text-danger"
          onClick={toggleLike}
          testId="post-like"
        />
        <ActionButton
          icon={<MessageCircle className="size-4" aria-hidden />}
          label={game.comment_count > 0 ? `${game.comment_count}` : t.post.comment}
          onClick={onComment}
          testId="post-comment"
        />
        <ActionButton
          icon={<Bookmark className={cn("size-4", saved && "fill-current")} aria-hidden />}
          label={t.post.save}
          active={saved}
          activeClass="text-violet"
          onClick={toggleSave}
          testId="post-save"
        />
        <ActionButton
          icon={<Share2 className="size-4" aria-hidden />}
          label={t.post.share}
          onClick={() => void share(game)}
        />
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  href,
  active = false,
  activeClass,
  testId,
}: {
  icon: ReactElement;
  label: string;
  onClick?: () => void;
  href?: string;
  active?: boolean;
  activeClass?: string;
  testId?: string;
}): ReactElement {
  const className = cn(
    "flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-medium",
    "text-ink-secondary transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink",
    active && activeClass,
  );
  if (href) {
    return (
      <Link href={href} scroll={false} className={className}>
        {icon}
        <span className="hidden sm:inline">{label}</span>
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className} data-testid={testId}>
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// ── comments: newest previews (collapsed) → expandable thread + composer ──

function PostComments({
  game,
  expanded,
  onExpand,
  composerRef,
}: {
  game: FeedItem;
  expanded: boolean;
  onExpand: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
}): ReactElement {
  const { t, f } = useI18n();
  // Only fetch the full thread once expanded — the feed stays cheap otherwise.
  const comments = useComments(game.id, { enabled: expanded });
  const previews = game.preview_comments;
  const hiddenCount = Math.max(0, game.comment_count - previews.length);

  return (
    <div className="flex flex-col gap-2 px-4 pb-3 pt-1">
      {!expanded && hiddenCount > 0 && (
        <button
          type="button"
          onClick={onExpand}
          className="self-start text-xs font-medium text-ink-muted hover:text-ink"
          data-testid="post-view-comments"
        >
          {f.msg(t.post.viewAllComments, { count: game.comment_count })}
        </button>
      )}

      {!expanded &&
        previews.map((comment) => (
          <p
            key={comment.id}
            className="min-w-0 text-sm leading-snug"
            data-testid="post-comment-preview"
          >
            <Link
              href={`/u/${comment.author.handle}`}
              className="me-1.5 font-semibold text-ink hover:underline"
            >
              {comment.author.display_name || comment.author.handle}
            </Link>
            <span className="break-words text-ink-secondary">{comment.body}</span>
          </p>
        ))}

      {expanded && (
        <CommentList
          gameId={game.id}
          ownerHandle={game.owner.handle}
          comments={comments}
        />
      )}

      <CommentComposer gameId={game.id} inputRef={composerRef} onSubmitted={onExpand} />
    </div>
  );
}
