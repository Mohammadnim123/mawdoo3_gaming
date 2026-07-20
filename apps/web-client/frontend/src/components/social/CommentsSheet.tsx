"use client";

import type { ReactElement } from "react";
import { Dialog } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { CommentThread } from "@/components/comments";

/**
 * Comments as an overlay surface (E16-F8): the ui Dialog renders as a
 * drag-to-dismiss bottom sheet on phones and a centered panel on desktop —
 * the game keeps running behind it.
 */
export function CommentsSheet({
  open,
  onClose,
  gameId,
  ownerHandle,
  commentCount,
}: {
  open: boolean;
  onClose: () => void;
  gameId: string;
  ownerHandle: string;
  commentCount: number;
}): ReactElement {
  const { t, f } = useI18n();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={f.plural(t.comments.count, commentCount)}
      closeLabel={t.ui.closeDialog}
    >
      <CommentThread gameId={gameId} ownerHandle={ownerHandle} className="max-h-[60dvh]" />
    </Dialog>
  );
}
