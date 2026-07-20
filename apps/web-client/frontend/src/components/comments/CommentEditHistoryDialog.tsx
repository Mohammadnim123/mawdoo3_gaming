"use client";

import type { ReactElement } from "react";
import { Dialog, Skeleton } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useCommentHistory } from "@/domain/hooks/useComments";

/**
 * The prior bodies of an edited comment (E39) — newest first, each with the
 * timestamp of when it was superseded. Fetched only while open.
 */
export function CommentEditHistoryDialog({
  open,
  onClose,
  commentId,
}: {
  open: boolean;
  onClose: () => void;
  commentId: string;
}): ReactElement {
  const { t, f } = useI18n();
  const history = useCommentHistory(commentId, open);
  const items = history.data?.items ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.comments.editHistory}
      closeLabel={t.ui.closeDialog}
    >
      <div className="flex flex-col gap-3" data-testid="comment-history">
        {history.isPending && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-2xl" />
            ))}
          </div>
        )}
        {history.isSuccess && items.length === 0 && (
          <p className="text-sm text-ink-muted">{t.comments.editHistoryEmpty}</p>
        )}
        {items.map((entry, index) => (
          <div
            key={`${entry.created_at}-${index}`}
            className="flex flex-col gap-1 rounded-2xl border border-edge-subtle bg-surface-2 p-3"
          >
            <time dateTime={entry.created_at} className="text-xs text-ink-muted">
              {f.dateTime(entry.created_at)}
            </time>
            <p className="whitespace-pre-wrap break-words text-sm text-ink">{entry.body}</p>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
