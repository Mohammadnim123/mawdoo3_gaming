"use client";

import type { ReactElement } from "react";
import { cn } from "@codply/ui";
import { useComments } from "@/domain/hooks/useComments";
import { CommentComposer } from "./CommentComposer";
import { CommentList } from "./CommentList";

/**
 * The full comment thread (E39): a scrollable top-level list + Load more with
 * the composer pinned at the bottom. Reusable wherever a game's comments own
 * the surface — the game page and the player overlay's sheet.
 */
export function CommentThread({
  gameId,
  ownerHandle,
  className,
  autoFocus,
}: {
  gameId: string;
  ownerHandle: string;
  className?: string;
  autoFocus?: boolean;
}): ReactElement {
  const comments = useComments(gameId);

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pe-1">
        <CommentList gameId={gameId} ownerHandle={ownerHandle} comments={comments} />
      </div>
      <CommentComposer
        gameId={gameId}
        autoFocus={autoFocus}
        className="border-t border-edge-subtle pt-3"
      />
    </div>
  );
}
