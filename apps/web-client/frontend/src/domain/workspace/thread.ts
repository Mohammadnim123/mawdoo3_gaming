import type { ChatMessage } from "@codply/contracts";

/**
 * Pure thread model for the workspace chat (E14-F2): chat history + the
 * optimistic pending message + ONE generation-card marker for the active job,
 * grouped by day. Screens render this — they never re-derive it.
 */

export interface ThreadMessageItem {
  kind: "message";
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  /** E40: attached image (CDN url for history, data URL for the optimistic
   *  echo), rendered inside the bubble above the text. */
  imageUrl?: string | null;
  /** Optimistic message not yet acknowledged by the API. */
  pending?: boolean;
}

/** Placement marker for the (single) live/latest generation card. */
export interface ThreadJobItem {
  kind: "job";
  id: string;
  jobId: string;
}

/** v0.5→E28: marker for a PAST job — renders its persisted transcript card
 * (snapshot `transcript`), or the one-line outcome note when no transcript
 * is available. Earlier runs must never vanish from the thread. */
export interface ThreadPastJobItem {
  kind: "pastjob";
  id: string;
  jobId: string;
  /** Terminal outcome from the history join — the fallback note's content. */
  status: string;
  errorCode: string | null;
}

export type ThreadItem = ThreadMessageItem | ThreadJobItem | ThreadPastJobItem;

export interface ThreadDay {
  /** Local calendar day key (YYYY-MM-DD). */
  key: string;
  /** "Today" / "Yesterday" / formatted date. */
  label: string;
  items: ThreadItem[];
}

export interface BuildThreadInput {
  history: ChatMessage[];
  /** Optimistic user message (submitted, not yet in history). */
  pending: { content: string; at: string; imageUrl?: string | null } | null;
  /** Prompt recovered from a `/create` → `/studio?job=` handoff. */
  handoffPrompt: string | null;
  /** Job whose generation card renders in the thread (live or latest). */
  activeJobId: string | null;
  /**
   * E18: true while the generation card is rendering this job's own transcript
   * (live stream timeline has narration). Exactly ONE surface owns the active
   * job's narration at a time — while the card shows it, persisted assistant
   * rows for `activeJobId` are suppressed here; after a reload the timeline is
   * empty (terminal jobs don't replay), so the thread renders them instead.
   */
  activeJobTranscript?: boolean;
  /**
   * E28: past jobs whose transcript card is rendering narration — their
   * persisted assistant rows are suppressed exactly like the active job's
   * (one surface owns narration at a time).
   */
  transcriptJobIds?: ReadonlySet<string>;
  now?: Date;
  /** E33: localized divider copy; defaults keep the English UI. */
  dayLabels?: DayLabelOptions;
}

/** Divider copy + date renderer for `dayLabel` (E33 localizable). */
export interface DayLabelOptions {
  today?: string;
  yesterday?: string;
  /** Renders a (year, month 1-12, day) local date; default en short form. */
  formatDate?: (year: number, month: number, day: number) => string;
}

/** Terminal states that earn a past job its persistent thread marker. */
const PAST_TERMINAL_STATUSES = ["done", "failed", "expired"];

/** Local calendar-day key for an ISO timestamp. */
export function dayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** "Today" / "Yesterday" / "Mon, Jul 7" style divider label. */
export function dayLabel(
  key: string,
  now: Date = new Date(),
  labels: DayLabelOptions = {},
): string {
  if (key === dayKey(now.toISOString())) return labels.today ?? "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === dayKey(yesterday.toISOString())) return labels.yesterday ?? "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  if (labels.formatDate) return labels.formatDate(y, m, d);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * True once the server has acknowledged the optimistic pending bubble: the
 * chat history contains the USER row for the job that send created. From
 * that moment the history row (with the generation card spliced after it)
 * represents the prompt — keeping the echo too rendered the message twice
 * for the whole build (seen live: fresh-game runs load the server-seeded
 * thread while the job is still running).
 */
export function pendingAcknowledged(
  history: ChatMessage[],
  activeJobId: string | null,
  pending: { content: string; at: string } | null,
): boolean {
  if (pending === null || activeJobId === null) return false;
  return history.some((m) => m.role === "user" && m.job_id === activeJobId);
}

/** Most recent job referenced by the chat history (hydration target). */
export function latestJobId(history: ChatMessage[]): string | null {
  const sorted = sortByCreated(history);
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const jobId = sorted[i]?.job_id;
    if (jobId) return jobId;
  }
  return null;
}

function sortByCreated(history: ChatMessage[]): ChatMessage[] {
  return [...history].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Past TERMINAL jobs referenced by the thread, in thread order — the
 * transcript-card fetch list (E28). The active job is the stream's business. */
export function pastJobIds(history: ChatMessage[], activeJobId: string | null): string[] {
  const ids: string[] = [];
  for (const m of sortByCreated(history)) {
    if (m.role !== "user" || m.job_id === null || m.job_id === undefined) continue;
    if (m.job_id === activeJobId || ids.includes(m.job_id)) continue;
    if (m.job === null || m.job === undefined) continue;
    if (!PAST_TERMINAL_STATUSES.includes(m.job.status)) continue;
    ids.push(m.job_id);
  }
  return ids;
}

/**
 * Assemble the thread: messages sorted by time, the handoff prompt standing
 * in when history is empty, the pending bubble last, and the generation-card
 * marker after the LAST user message that started `activeJobId` (or at the
 * end when no history message references it yet).
 */
export function buildThread(input: BuildThreadInput): ThreadDay[] {
  const now = input.now ?? new Date();
  const items: ThreadItem[] = [];
  for (const m of sortByCreated(input.history)) {
    // E18/E28: a job card rendering its own transcript owns that job's
    // narration — the thread must not double-render the persisted copies of
    // those same assistant rows (live card for the active job, snapshot
    // transcript card for past ones).
    const jobId = m.job_id ?? null;
    const cardOwnsNarration =
      jobId !== null &&
      (jobId === input.activeJobId
        ? input.activeJobTranscript === true
        : input.transcriptJobIds?.has(jobId) === true);
    if (m.role === "assistant" && cardOwnsNarration) {
      continue;
    }
    items.push({
      kind: "message",
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      created_at: m.created_at,
      imageUrl: m.image_url ?? null,
    });
    // v0.5→E28: past jobs keep a persistent marker under the message that
    // started them — the full transcript card when a snapshot transcript
    // exists, the one-line outcome note otherwise (the live card renders
    // only for the active job).
    if (
      m.role === "user" &&
      jobId !== null &&
      jobId !== input.activeJobId &&
      m.job !== null &&
      m.job !== undefined &&
      PAST_TERMINAL_STATUSES.includes(m.job.status)
    ) {
      items.push({
        kind: "pastjob",
        id: `pastjob-${m.id}`,
        jobId,
        status: m.job.status,
        errorCode: m.job.error_code,
      });
    }
  }

  // The pending bubble IS the prompt while a send is in flight — the recalled
  // handoff only stands in once nothing else represents it (fresh reload).
  if (
    items.length === 0 &&
    input.pending === null &&
    input.handoffPrompt !== null &&
    input.handoffPrompt !== ""
  ) {
    items.push({
      kind: "message",
      id: "handoff",
      role: "user",
      content: input.handoffPrompt,
      created_at: now.toISOString(),
    });
  }

  if (input.pending !== null) {
    items.push({
      kind: "message",
      id: "pending",
      role: "user",
      content: input.pending.content,
      created_at: input.pending.at,
      imageUrl: input.pending.imageUrl ?? null,
      pending: true,
    });
  }

  if (input.activeJobId !== null) {
    const marker: ThreadJobItem = { kind: "job", id: `job-${input.activeJobId}`, jobId: input.activeJobId };
    let insertAt = items.length;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item?.kind !== "message" || item.role !== "user") continue;
      const source = input.history.find((m) => m.id === item.id);
      if (source?.job_id === input.activeJobId) {
        insertAt = i + 1;
        break;
      }
    }
    items.splice(insertAt, 0, marker);
    // E18: live narration is NOT spliced as separate bubbles any more — the
    // job card renders it interleaved with tool actions (stream.timeline),
    // exactly like a Claude transcript. Persisted assistant rows from past
    // jobs still render as messages above.
  }

  // Group into day buckets; card markers inherit the day of what precedes them.
  const days: ThreadDay[] = [];
  let current: ThreadDay | null = null;
  for (const item of items) {
    const key: string =
      item.kind === "message" ? dayKey(item.created_at) : (current?.key ?? dayKey(now.toISOString()));
    if (current === null || current.key !== key) {
      current = { key, label: dayLabel(key, now, input.dayLabels ?? {}), items: [] };
      days.push(current);
    }
    current.items.push(item);
  }
  return days;
}
