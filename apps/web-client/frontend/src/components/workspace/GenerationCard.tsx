"use client";

import { useState, type ReactElement } from "react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Gamepad2,
  OctagonX,
  PartyPopper,
  RotateCcw,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import type { FailedEventData } from "@codply/contracts";
import {
  ActivityFeed,
  Button,
  ClarifyCards,
  FailureNotice,
  ThinkingIndicator,
  cn,
  effectiveAnswers,
  resolveIcon,
  stepMeta,
} from "@codply/ui";
import { stepLabel } from "@/domain/i18n";
import { useI18n, type I18nContextValue } from "@/components/i18n/I18nProvider";
import type { UseJobStreamResult } from "@/domain/jobStream/useJobStream";
import { isThinking } from "@/domain/workspace/activity";
import {
  failureActions,
  failureTitleKey,
  failureTone,
  type FailureActionKind,
} from "@/domain/workspace/failureActions";
import { isTerminalStatus, type JobActivity } from "@/domain/jobStream/reducer";

export interface GenerationCardProps {
  stream: UseJobStreamResult;
  /** E28: static transcript replay of a finished PAST job — the same card
   * minus live affordances (questions, retry/fix/play are the ACTIVE job's
   * business; a past job's outcome rows are read-only). */
  past?: boolean;
  /** Locally-known cancel (the finalize path emits no SSE event). */
  cancelled?: boolean;
  onSubmitAnswers?: (answers: Record<string, string>) => void;
  submittingAnswers?: boolean;
  onRetry?: () => void;
  /** E04-F14 conversational recovery: sends a fix-it chat message; the agent
   * continues from its failed draft. Omit when no project exists to recover. */
  onFixIt?: () => void;
  /** Jump to the Game tab from the done row. */
  onPlay?: () => void;
  /** E29-F2: viewer's subscription plan key (null while unknown) — gates
   * the plan-aware upgrade action on exhaustion failures. */
  planKey?: string | null;
  /** E29-F2: opens the workspace's PricingDialog (same instance the
   * credits-exhausted flow uses — never mount a second one). */
  onUpgrade?: () => void;
  className?: string;
}

/** Human summary of a tool run: "Read 3 files · 4 edits · 2 commands". */
function toolGroupSummary(items: JobActivity[], { t, f }: I18nContextValue): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const segment = (kind: string, n: number): string => {
    switch (kind) {
      case "read":
        return f.plural(t.workspace.card.readFiles, n);
      case "write":
        return f.plural(t.workspace.card.edits, n);
      case "test":
        return f.plural(t.workspace.card.checks, n);
      case "asset":
        return f.plural(t.workspace.card.assets, n);
      case "think":
        return f.msg(t.workspace.card.thought, { count: n });
      default:
        return f.plural(t.workspace.card.actions, n);
    }
  };
  return [...counts.entries()].map(([kind, n]) => segment(kind, n)).join(" · ");
}

/**
 * A collapsible run of consecutive tool actions (E18) — collapsed groups read
 * as one summary line; the live group stays open while the agent works.
 */
function ToolGroup({
  items,
  defaultOpen,
}: {
  items: JobActivity[];
  defaultOpen: boolean;
}): ReactElement {
  const i18n = useI18n();
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? defaultOpen;
  const busy = items.some((a) => a.status === "running");
  const failed = items.some((a) => a.status === "error");
  return (
    <div data-testid="tool-group">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className={cn(
          "flex w-full items-center gap-1.5 text-start text-xs font-medium",
          "text-ink-muted transition-colors duration-150 ease-out hover:text-ink",
        )}
      >
        <ChevronRight
          className={cn(
            "fp-flip-rtl size-3.5 shrink-0 transition-transform duration-150",
            expanded && "rotate-90",
          )}
          aria-hidden
        />
        <span className="min-w-0 truncate">{toolGroupSummary(items, i18n)}</span>
        {busy && <span className="fp-pulse size-1.5 shrink-0 rounded-full bg-violet" aria-hidden />}
        {failed && !busy && <CircleAlert className="size-3.5 shrink-0 text-danger" aria-hidden />}
      </button>
      {expanded && (
        <ActivityFeed items={items} className="ms-1.5 border-s border-edge-subtle ps-3 pt-1" />
      )}
    </div>
  );
}

/**
 * One job's live card in the thread (E14-F3 + E18): compact step status rows,
 * then the interleaved transcript — the agent's own narration alternating
 * with collapsible tool-run groups in true chronological order — plus real
 * thinking status, inline clarify cards, and done/failed/cancelled footers.
 */
export function GenerationCard({
  stream,
  past = false,
  cancelled = false,
  onSubmitAnswers,
  submittingAnswers = false,
  onRetry,
  onFixIt,
  onPlay,
  planKey = null,
  onUpgrade,
  className,
}: GenerationCardProps): ReactElement {
  const { t, f } = useI18n();
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const failed: FailedEventData | null =
    stream.failed ??
    (cancelled && !isTerminalStatus(stream.status)
      ? { error_code: "cancelled", error_user_msg: t.workspace.card.cancelledMsg, refunded: true }
      : null);
  const isCancelled = failed?.error_code === "cancelled";
  const running = failed === null && stream.done === null;
  const awaiting = running && stream.status === "awaiting_input" && stream.questions.length > 0;

  // E29-F2: plan-aware failure actions, keyed off the wire error_code. A
  // past card is read-only — it renders the notice without actions.
  const actions = failed !== null && !isCancelled ? failureActions(failed.error_code, planKey) : [];
  const showFixIt = !past && onFixIt !== undefined && actions.some((a) => a.kind === "fixIt");
  const actionLabels: Record<FailureActionKind, string> = {
    fixIt: t.failure.fixIt,
    tryAgain: t.failure.tryAgain,
    upgrade: t.failure.upgradeBigger,
  };

  return (
    <div
      className={cn("flex flex-col gap-2 rounded-2xl border border-edge bg-surface-1 p-3", className)}
      data-testid="generation-card"
      data-status={failed ? "failed" : stream.done ? "done" : "running"}
      data-variant={past ? "past" : "live"}
    >
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
        <Sparkles className={cn("size-3.5 text-violet", running && "fp-pulse")} aria-hidden />
        {running
          ? t.workspace.card.workingOnIt
          : stream.done
            ? t.workspace.card.done
            : isCancelled
              ? t.workspace.card.stopped
              : t.workspace.card.failed}
      </p>

      {stream.steps.length === 0 && running && (
        <ThinkingIndicator label={t.workspace.card.warmingUp} />
      )}

      <ol className="flex flex-col gap-1">
        {stream.steps.map((step) => {
          const meta = stepMeta(step.step);
          const localizedStep = stepLabel(t, step.step);
          const Icon = resolveIcon(meta.icon);
          const isRunning = step.status === "running";
          return (
            <li key={step.step} data-step={step.step} data-status={step.status}>
              {/* Section header — compact step row. */}
              <div className="flex items-center gap-2 py-0.5">
                <Icon
                  className={cn("size-4 shrink-0", isRunning && "fp-pulse")}
                  style={{ color: step.status === "pending" ? undefined : meta.color }}
                  aria-hidden
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm font-medium",
                    step.status === "pending" && "text-ink-muted",
                    isRunning && "text-ink",
                    step.status === "done" && "text-ink-secondary",
                    step.status === "failed" && "text-danger",
                  )}
                >
                  {step.label || localizedStep}
                </span>
                {step.status === "done" && (
                  <Check className="size-3.5 shrink-0" style={{ color: meta.color }} aria-hidden />
                )}
                {step.status === "failed" && <X className="size-3.5 shrink-0 text-danger" aria-hidden />}
                {isRunning && (
                  <span
                    className="fp-pulse size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: meta.color }}
                    aria-hidden
                  />
                )}
              </div>
              {isRunning && stream.progressDetail && (
                <p className="truncate ps-6 text-xs text-ink-muted" data-testid="card-progress">
                  {stream.progressDetail}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {/* E18: the transcript — narration and tool runs interleaved in true
          order, exactly like reading a Claude session. */}
      {stream.timeline.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-edge-subtle pt-2" data-testid="card-timeline">
          {stream.timeline.map((item, index) =>
            item.type === "text" ? (
              <p
                key={item.id}
                className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink"
              >
                {item.content}
              </p>
            ) : (
              <ToolGroup
                key={item.id}
                items={item.items}
                defaultOpen={running && index === stream.timeline.length - 1}
              />
            ),
          )}
        </div>
      )}

      {stream.healNotes.map((heal) => (
        <p
          key={heal.attempt}
          className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
          data-testid="card-heal"
        >
          <Wrench className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {heal.summary}
        </p>
      ))}

      {isThinking(stream.activities) && (
        <ThinkingIndicator className="ps-1" label={t.ui.thinking} />
      )}

      {awaiting && onSubmitAnswers !== undefined && (
        <ClarifyCards
          questions={stream.questions}
          value={answers}
          onChange={setAnswers}
          onSubmit={(effective) => onSubmitAnswers(effective)}
          onSurpriseMe={() => onSubmitAnswers(effectiveAnswers(stream.questions, {}))}
          submitting={submittingAnswers}
          labels={{
            surpriseMe: t.clarify.surpriseMe,
            submit: t.clarify.letsGo,
            answerPlaceholder: t.clarify.answerPlaceholder,
          }}
        />
      )}

      {stream.done && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-2">
          <PartyPopper className="size-4 shrink-0 text-success" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-success">
            {past
              ? t.workspace.card.shippedVersion
              : stream.done.title
                ? f.msg(t.workspace.card.titleIsLive, { title: stream.done.title })
                : t.workspace.card.versionIsLive}
          </p>
          {!past && onPlay && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onPlay}
              leftIcon={<Gamepad2 className="size-4" aria-hidden />}
            >
              {t.workspace.card.playIt}
            </Button>
          )}
        </div>
      )}

      {/* Cancelled keeps its lighter single-row treatment — the player
          stopped it; there is nothing to diagnose. */}
      {failed && isCancelled && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border border-edge bg-surface-2 px-3 py-2"
          role="status"
          data-testid="card-cancelled"
        >
          <OctagonX className="size-4 shrink-0 text-ink-muted" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-ink-secondary">
            {t.workspace.card.generationStopped}
          </p>
          {!past && onRetry !== undefined && (
            <Button
              variant="soft"
              size="sm"
              onClick={onRetry}
              leftIcon={<RotateCcw className="size-4" aria-hidden />}
            >
              {t.workspace.card.tryAgain}
            </Button>
          )}
        </div>
      )}

      {/* E29-F2: stacked, truthful failure notice — short family title, the
          server's specific error_user_msg full-width, plan-aware actions. */}
      {failed && !isCancelled && (
        <FailureNotice
          title={t.failure[failureTitleKey(failed.error_code)]}
          description={failed.error_user_msg}
          hint={showFixIt ? t.workspace.card.fixItHint : undefined}
          data-testid="card-failed"
          data-tone={failureTone(failed.error_code)}
        >
          {actions.map((action) => {
            if (past) return null;
            if (action.kind === "fixIt" && onFixIt !== undefined) {
              return (
                <Button
                  key={action.kind}
                  variant="gradient-cta"
                  size="sm"
                  onClick={onFixIt}
                  leftIcon={<Wrench className="size-4" aria-hidden />}
                  data-testid="card-fix-it"
                >
                  {actionLabels[action.kind]}
                </Button>
              );
            }
            if (action.kind === "tryAgain" && onRetry !== undefined) {
              return (
                <Button
                  key={action.kind}
                  variant="soft"
                  size="sm"
                  onClick={onRetry}
                  leftIcon={<RotateCcw className="size-4" aria-hidden />}
                >
                  {actionLabels[action.kind]}
                </Button>
              );
            }
            if (action.kind === "upgrade" && onUpgrade !== undefined) {
              return (
                <Button
                  key={action.kind}
                  variant="solid"
                  size="sm"
                  onClick={onUpgrade}
                  leftIcon={<Sparkles className="size-4" aria-hidden />}
                  data-testid="card-upgrade"
                >
                  {actionLabels[action.kind]}
                </Button>
              );
            }
            return null;
          })}
        </FailureNotice>
      )}
    </div>
  );
}
