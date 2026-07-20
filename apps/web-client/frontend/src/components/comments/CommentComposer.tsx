"use client";

import { useRef, useState, type ReactElement, type RefObject } from "react";
import { SendHorizontal } from "lucide-react";
import type { Comment } from "@codply/contracts";
import { ApiError } from "@codply/contracts";
import { Avatar, Textarea, cn, useToast } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useMe } from "@/domain/hooks/useMe";
import { useCreateComment } from "@/domain/hooks/useComments";
import { useRequireAuth } from "@/domain/hooks/useSocial";

export interface CommentComposerProps {
  gameId: string;
  /** Set → posts as a reply attached to this top-level comment. */
  parentId?: string;
  autoFocus?: boolean;
  /** Focus the input from a parent (the feed's Comment button). */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
  /** Called with the created comment once it lands. */
  onSubmitted?: (comment: Comment) => void;
  className?: string;
}

/**
 * The shared comment/reply composer: Enter submits, Shift+Enter inserts a
 * newline, the send button mirrors it. Disabled while pending; clears on
 * success. Anonymous users are gated to login. FLAT, tokens only, RTL-safe.
 */
export function CommentComposer({
  gameId,
  parentId,
  autoFocus,
  inputRef,
  placeholder,
  onSubmitted,
  className,
}: CommentComposerProps): ReactElement {
  const { t } = useI18n();
  const { data: me } = useMe();
  const { gate } = useRequireAuth();
  const { toast } = useToast();
  const create = useCreateComment(gameId);
  const [body, setBody] = useState("");
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? localRef;

  const submit = (): void => {
    const value = body.trim();
    if (value.length === 0 || create.isPending) return;
    if (!gate()) return;
    create.mutate(
      { body: value, parentId },
      {
        onSuccess: (comment) => {
          setBody("");
          onSubmitted?.(comment);
        },
        onError: (error) => {
          toast({
            title:
              ApiError.isApiError(error) && error.code === "moderation_blocked"
                ? t.comments.blocked
                : t.comments.postFailed,
            variant: "error",
          });
        },
      },
    );
  };

  return (
    <div className={cn("flex items-start gap-2 pt-1", className)}>
      <Avatar
        name={me?.display_name || me?.handle || t.common.you}
        src={me?.avatar_url ?? undefined}
        size="sm"
        className="mt-1 shrink-0"
      />
      <Textarea
        ref={ref}
        value={body}
        autoFocus={autoFocus}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        rows={1}
        maxLength={500}
        placeholder={placeholder ?? (me ? t.comments.addComment : t.comments.logInToJoin)}
        aria-label={t.comments.addCommentAria}
        className="min-h-10 flex-1"
      />
      <button
        type="button"
        onClick={submit}
        disabled={body.trim().length === 0 || create.isPending}
        aria-label={t.post.postComment}
        data-testid="comment-send"
        className={cn(
          "mt-1 flex size-9 shrink-0 items-center justify-center rounded-full text-violet",
          "transition-colors duration-150 ease-out hover:bg-surface-2 disabled:opacity-40",
        )}
      >
        <SendHorizontal className="fp-flip-rtl size-4" aria-hidden />
      </button>
    </div>
  );
}
