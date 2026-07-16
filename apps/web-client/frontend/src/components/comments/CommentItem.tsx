"use client";

import Link from "next/link";
import { useState, type ReactElement } from "react";
import { Heart, History, Pencil, Reply, Trash2 } from "lucide-react";
import type { Comment } from "@codply/contracts";
import { Avatar, Button, Dialog, Skeleton, Textarea, cn, useToast } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMe } from "@/domain/hooks/useMe";
import { useRequireAuth } from "@/domain/hooks/useSocial";
import {
  useCommentReplies,
  useDeleteComment,
  useEditComment,
  useToggleCommentLike,
} from "@/domain/hooks/useComments";
import { CommentComposer } from "./CommentComposer";
import { CommentEditHistoryDialog } from "./CommentEditHistoryDialog";
import { RelativeTime } from "./RelativeTime";

export interface CommentItemProps {
  gameId: string;
  comment: Comment;
  /** Game owner's handle — owners may moderate any comment on their thread. */
  ownerHandle: string;
  /** A reply renders indented with no further nesting affordance (one level). */
  isReply?: boolean;
}

/**
 * One comment: author identity, body (or tombstone / inline editor), a Like /
 * Reply / Edit / Delete action row, an "edited" marker that opens the edit
 * history, and — top level only — a lazy-loaded replies thread (one level).
 */
export function CommentItem({
  gameId,
  comment,
  ownerHandle,
  isReply = false,
}: CommentItemProps): ReactElement {
  const { t, f } = useI18n();
  const { data: me } = useMe();
  const { gate } = useRequireAuth();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [replying, setReplying] = useState(false);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const likeToggle = useToggleCommentLike(gameId);
  const editMutation = useEditComment(gameId);
  const deleteMutation = useDeleteComment(gameId);

  const isAuthor = !!me && me.handle === comment.user.handle;
  const canModerate =
    !!me && (isAuthor || me.handle === ownerHandle || me.role === "admin");
  const canEdit = isAuthor && !comment.deleted;
  const canDelete = canModerate && !comment.deleted;

  const authorName = comment.user.display_name || comment.user.handle;

  const onLike = (): void => {
    if (!gate()) return;
    likeToggle.mutate({ commentId: comment.id, next: !comment.viewer_liked });
  };

  const onSaveEdit = (): void => {
    const value = editBody.trim();
    if (value.length === 0 || value === comment.body || editMutation.isPending) return;
    editMutation.mutate(
      { commentId: comment.id, body: value },
      {
        onSuccess: () => setEditing(false),
        onError: () => toast({ title: t.comments.editFailed, variant: "error" }),
      },
    );
  };

  const onConfirmDelete = (): void => {
    deleteMutation.mutate(comment.id, {
      onSuccess: () => setConfirmDelete(false),
      onError: () => toast({ title: t.comments.deleteFailed, variant: "error" }),
    });
  };

  return (
    <div className={cn("flex flex-col gap-2", isReply && "ms-8")} data-testid="comment-item">
      <div className="flex items-start gap-2.5">
        <Link href={`/u/${comment.user.handle}`} className="mt-0.5 shrink-0">
          <Avatar name={authorName} src={comment.user.avatar_url ?? undefined} size="sm" />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-muted">
            <Link
              href={`/u/${comment.user.handle}`}
              className="font-semibold text-ink hover:underline"
            >
              {authorName}
            </Link>
            <Link
              href={`/u/${comment.user.handle}`}
              className="text-ink-secondary hover:text-ink"
              dir="ltr"
            >
              @{comment.user.handle}
            </Link>
            <span aria-hidden>·</span>
            <RelativeTime iso={comment.created_at} />
          </p>

          {comment.deleted ? (
            <p className="text-sm italic text-ink-muted" data-testid="comment-tombstone">
              {t.comments.deleted}
            </p>
          ) : editing ? (
            <div className="flex flex-col gap-2 pt-1">
              <Textarea
                value={editBody}
                onChange={(event) => setEditBody(event.target.value)}
                rows={2}
                maxLength={500}
                aria-label={t.common.edit}
                autoFocus
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="solid"
                  size="sm"
                  onClick={onSaveEdit}
                  loading={editMutation.isPending}
                  disabled={editBody.trim().length === 0 || editBody.trim() === comment.body}
                >
                  {t.common.save}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setEditBody(comment.body);
                  }}
                >
                  {t.common.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm text-ink">
              {comment.body}
              {comment.edited_at && (
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  className="ms-2 inline-flex items-center gap-1 align-baseline text-xs font-medium text-ink-muted transition-colors duration-150 ease-out hover:text-ink"
                  data-testid="comment-edited"
                >
                  <History className="size-3" aria-hidden />
                  {t.comments.edited}
                </button>
              )}
            </p>
          )}

          {!comment.deleted && !editing && (
            <div className="flex items-center gap-3 pt-0.5">
              <button
                type="button"
                onClick={onLike}
                aria-pressed={comment.viewer_liked}
                aria-label={t.comments.like}
                className={cn(
                  "flex items-center gap-1 text-xs font-medium transition-colors duration-150 ease-out",
                  comment.viewer_liked
                    ? "text-danger"
                    : "text-ink-muted hover:text-ink",
                )}
                data-testid="comment-like"
              >
                <Heart
                  className={cn("size-3.5", comment.viewer_liked && "fill-current")}
                  aria-hidden
                />
                {comment.like_count > 0 && <span>{f.number(comment.like_count)}</span>}
              </button>

              {!isReply && (
                <button
                  type="button"
                  onClick={() => setReplying((v) => !v)}
                  className="flex items-center gap-1 text-xs font-medium text-ink-muted transition-colors duration-150 ease-out hover:text-ink"
                  data-testid="comment-reply"
                >
                  <Reply className="fp-flip-rtl size-3.5" aria-hidden />
                  {t.comments.reply}
                </button>
              )}

              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setEditBody(comment.body);
                    setEditing(true);
                  }}
                  className="flex items-center gap-1 text-xs font-medium text-ink-muted transition-colors duration-150 ease-out hover:text-ink"
                  data-testid="comment-edit"
                >
                  <Pencil className="size-3.5" aria-hidden />
                  {t.common.edit}
                </button>
              )}

              {canDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1 text-xs font-medium text-ink-muted transition-colors duration-150 ease-out hover:text-danger"
                  data-testid="comment-delete"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  {t.common.delete}
                </button>
              )}
            </div>
          )}

          {replying && (
            <CommentComposer
              gameId={gameId}
              parentId={comment.id}
              autoFocus
              placeholder={f.msg(t.comments.replyingTo, { handle: comment.user.handle })}
              onSubmitted={() => {
                setReplying(false);
                setRepliesOpen(true);
              }}
              className="pt-1"
            />
          )}
        </div>
      </div>

      {!isReply && comment.reply_count > 0 && (
        <button
          type="button"
          onClick={() => setRepliesOpen((v) => !v)}
          className="ms-8 self-start text-xs font-medium text-violet transition-colors duration-150 ease-out hover:text-cyan"
          data-testid="comment-view-replies"
        >
          {repliesOpen
            ? t.comments.hideReplies
            : f.plural(t.comments.viewReplies, comment.reply_count)}
        </button>
      )}

      {!isReply && repliesOpen && (
        <CommentReplies gameId={gameId} parentId={comment.id} ownerHandle={ownerHandle} />
      )}

      {comment.edited_at && (
        <CommentEditHistoryDialog
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          commentId={comment.id}
        />
      )}

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t.comments.deleteConfirmTitle}
        description={t.comments.deleteConfirmBody}
        closeLabel={t.ui.closeDialog}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={onConfirmDelete}
              loading={deleteMutation.isPending}
            >
              {t.common.delete}
            </Button>
          </>
        }
      />
    </div>
  );
}

/** Lazy-loaded one-level replies list (oldest first) with Load more. */
function CommentReplies({
  gameId,
  parentId,
  ownerHandle,
}: {
  gameId: string;
  parentId: string;
  ownerHandle: string;
}): ReactElement {
  const { t } = useI18n();
  const replies = useCommentReplies(gameId, parentId, true);
  const items = replies.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex flex-col gap-2">
      {replies.isPending && (
        <Skeleton className="ms-8 h-10 w-full rounded-2xl" data-testid="replies-loading" />
      )}
      {items.map((reply) => (
        <CommentItem
          key={reply.id}
          gameId={gameId}
          comment={reply}
          ownerHandle={ownerHandle}
          isReply
        />
      ))}
      {replies.hasNextPage && (
        <button
          type="button"
          onClick={() => void replies.fetchNextPage()}
          disabled={replies.isFetchingNextPage}
          className="ms-8 self-start text-xs font-medium text-violet transition-colors duration-150 ease-out hover:text-cyan"
        >
          {t.comments.loadMore}
        </button>
      )}
    </div>
  );
}
