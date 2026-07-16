"use client";

import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, MessageSquarePlus, OctagonX } from "lucide-react";
import { CopyButton, cn } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { ThreadDay, ThreadMessageItem, ThreadPastJobItem } from "@/domain/workspace/thread";

export interface ChatThreadProps {
  days: ThreadDay[];
  /** Renders the generation card for a `job` marker (screen owns the stream). */
  renderJobCard: (jobId: string) => ReactNode;
  /** E28: renders a PAST job's transcript card; the built-in one-line note
   * is the fallback when omitted. */
  renderPastJob?: (item: ThreadPastJobItem) => ReactNode;
  loading?: boolean;
  className?: string;
}

/**
 * The project's single timeline (E14-F2): day dividers, user bubbles right
 * with copy-on-hover, assistant bubbles left, generation cards inline.
 * Auto-scrolls to the newest entry.
 */
export function ChatThread({
  days,
  renderJobCard,
  renderPastJob,
  loading = false,
  className,
}: ChatThreadProps): ReactElement {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const itemCount = days.reduce((sum, d) => sum + d.items.length, 0);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [itemCount]);

  return (
    <div
      ref={scrollRef}
      className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-3 sm:p-4", className)}
      aria-live="polite"
      data-testid="chat-thread"
    >
      {!loading && itemCount === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <MessageSquarePlus className="size-8 text-violet" aria-hidden />
          <p className="text-sm font-medium text-ink">{t.workspace.thread.emptyTitle}</p>
          <p className="max-w-60 text-xs text-ink-muted">{t.workspace.thread.emptyDescription}</p>
        </div>
      )}

      {days.map((day) => (
        <section key={day.key} aria-label={day.label} className="flex flex-col gap-3">
          <div className="flex items-center gap-3" data-testid="day-divider">
            <span className="h-px flex-1 bg-edge-subtle" aria-hidden />
            <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
              {day.label}
            </span>
            <span className="h-px flex-1 bg-edge-subtle" aria-hidden />
          </div>
          {day.items.map((item) =>
            item.kind === "job" ? (
              <div key={item.id}>{renderJobCard(item.jobId)}</div>
            ) : item.kind === "pastjob" ? (
              <div key={item.id}>
                {renderPastJob !== undefined ? renderPastJob(item) : <JobNote note={item} />}
              </div>
            ) : (
              <MessageBubble key={item.id} message={item} />
            ),
          )}
        </section>
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: ThreadMessageItem }): ReactElement {
  const { t } = useI18n();
  const isUser = message.role === "user";
  const hasText = message.content.trim() !== "";
  // Copy targets the words only — an image-only message has nothing to copy.
  const copyButton = hasText ? (
    <CopyButton
      text={message.content}
      aria-label={t.workspace.thread.copyMessage}
      copiedLabel={t.common.copied}
      className="opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100"
    />
  ) : null;
  return (
    <div
      className={cn("group flex items-end gap-1.5", isUser ? "justify-end" : "justify-start")}
      data-role={message.role}
    >
      {isUser && copyButton}
      <div
        className={cn(
          "flex max-w-[85%] min-w-0 flex-col gap-2 rounded-2xl border px-3.5 py-2.5 text-sm",
          isUser ? "border-violet/40 bg-violet/15 text-ink" : "border-edge bg-surface-2 text-ink-secondary",
          message.pending && "opacity-60",
        )}
      >
        {/* E40: attached image (data URL while pending, CDN url once persisted).
            A plain <img> sidesteps next/image remote-domain config; the CDN
            already resizes and the chat column is narrow. */}
        {message.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- data URL (pending) / CDN chat image
          <img
            src={message.imageUrl}
            alt={t.workspace.composerInput.attach.preview}
            loading="lazy"
            className="max-h-64 w-auto max-w-full rounded-xl border border-edge-subtle object-contain"
          />
        )}
        {hasText && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
      </div>
      {!isUser && copyButton}
    </div>
  );
}

/** v0.5: persistent outcome line for a PAST run — the transcript never
 * forgets. E28: also the fallback when the transcript card can't render
 * (fetch failure, empty transcript on legacy jobs). */
export function JobNote({
  note,
}: {
  note: Pick<ThreadPastJobItem, "status" | "errorCode">;
}): ReactElement {
  const { t } = useI18n();
  const failed = note.status !== "done";
  const cancelled = note.errorCode === "cancelled";
  const Icon = cancelled ? OctagonX : failed ? CircleAlert : CheckCircle2;
  const label = cancelled
    ? t.workspace.thread.stoppedByYou
    : failed
      ? t.workspace.thread.runFailed
      : t.workspace.thread.shippedVersion;
  return (
    <div
      className="flex items-center gap-1.5 ps-1 text-xs text-ink-muted"
      data-testid="job-note"
      data-status={note.status}
    >
      <Icon
        className={cn(
          "size-3.5",
          cancelled ? "text-ink-muted" : failed ? "text-danger" : "text-success",
        )}
        aria-hidden
      />
      {label}
    </div>
  );
}
