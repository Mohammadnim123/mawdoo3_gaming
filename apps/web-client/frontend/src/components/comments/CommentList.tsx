"use client";

import type { ReactElement } from "react";
import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import type { Comment, PaginatedResponse } from "@codply/contracts";
import { Button, EmptyState, Skeleton, cn } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { CommentItem } from "./CommentItem";

type CommentsQuery = UseInfiniteQueryResult<
  { pages: PaginatedResponse<Comment>[]; pageParams: unknown[] },
  Error
>;

/**
 * The comment list: loading skeletons, empty + error states, the rows and a
 * Load more. Presentational — the query is owned by the caller (CommentThread
 * for the game page, PostCard for the feed) so both render identically.
 */
export function CommentList({
  gameId,
  ownerHandle,
  comments,
  className,
}: {
  gameId: string;
  ownerHandle: string;
  comments: CommentsQuery;
  className?: string;
}): ReactElement {
  const { t } = useI18n();
  const items = comments.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="comment-list">
      {comments.isPending && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {comments.isError && (
        <div className="flex flex-col items-start gap-2 py-2">
          <p className="text-sm text-ink-secondary">{t.comments.errorTitle}</p>
          <Button variant="soft" size="sm" onClick={() => void comments.refetch()}>
            {t.common.retry}
          </Button>
        </div>
      )}

      {comments.isSuccess && items.length === 0 && (
        <EmptyState
          icon={MessageCircle}
          title={t.comments.beFirst}
          description={t.comments.emptyDescription}
        />
      )}

      {items.map((comment) => (
        <CommentItem
          key={comment.id}
          gameId={gameId}
          comment={comment}
          ownerHandle={ownerHandle}
        />
      ))}

      {comments.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          loading={comments.isFetchingNextPage}
          onClick={() => void comments.fetchNextPage()}
        >
          {t.comments.loadMore}
        </Button>
      )}
    </div>
  );
}
