import {
  SSE_EVENT_SCHEMAS,
  type ActivityEventData,
  type ClarifyingQuestion,
  type DoneEventData,
  type FailedEventData,
  type FileEventData,
  type HealEventData,
  type Job,
  type JobStatus,
  type JobTranscriptItem,
  type MessageEventData,
  type SseEvent,
  type StepStatus,
} from "@codply/contracts";
import { applyActivity, type ActivityItem, type ActivityItemStatus } from "@codply/ui";

/** Timeline step shape consumed by `@codply/ui` StepTimeline. */
export interface StreamStep {
  step: string;
  label: string;
  status: StepStatus;
  started_at: string | null;
  ended_at: string | null;
}

/**
 * One live-activity row (CONVENTIONS §4.1) tagged with the pipeline step that
 * was running when it FIRST appeared — the generation card nests each row
 * under that step section, and upserts must never move a row between sections.
 */
export interface JobActivity extends ActivityItem {
  detail: string | null;
  agent: string | null;
  step: string | null;
}

/** One live assistant narration line (v0.5 `message` events). */
export interface StreamNarration {
  seq: number | null;
  content: string;
  kind: string | null;
}

/**
 * Interleaved transcript item (E18): narration text and tool-action groups in
 * TRUE chronological order — the Claude-style "text, then a collapsible run
 * of actions, then text" reading experience. Consecutive activities coalesce
 * into one group; a narration message closes the open group.
 */
export type TimelineItem =
  | { type: "text"; id: string; content: string; kind: string | null }
  | { type: "tools"; id: string; items: JobActivity[] };

export interface JobStreamState {
  status: JobStatus;
  steps: StreamStep[];
  questions: ClarifyingQuestion[];
  healNotes: HealEventData[];
  /** Assistant narration in arrival order (also persisted server-side). */
  messages: StreamNarration[];
  /** Upsert-by-id agent activity rows (E14-F3), in first-seen order. */
  activities: JobActivity[];
  /** Narration ↔ tool groups interleaved in arrival order (E18). */
  timeline: TimelineItem[];
  progressDetail: string | null;
  done: DoneEventData | null;
  failed: FailedEventData | null;
  /** Highest SSE seq applied — sent as `Last-Event-ID` on reconnect. */
  lastEventId: number | null;
}

export const initialJobStreamState: JobStreamState = {
  status: "queued",
  steps: [],
  questions: [],
  healNotes: [],
  messages: [],
  activities: [],
  timeline: [],
  progressDetail: null,
  done: null,
  failed: null,
  lastEventId: null,
};

let timelineCounter = 0;

/** Upsert an activity row into the timeline: update it wherever it lives, or
 * append to the trailing tools group (opening one if narration closed it). */
function timelineUpsert(timeline: TimelineItem[], row: JobActivity): TimelineItem[] {
  for (let i = 0; i < timeline.length; i++) {
    const item = timeline[i];
    if (item?.type !== "tools") continue;
    const at = item.items.findIndex((a) => a.id === row.id);
    if (at !== -1) {
      const next = [...timeline];
      const items = [...item.items];
      items[at] = row;
      next[i] = { ...item, items };
      return next;
    }
  }
  const last = timeline[timeline.length - 1];
  if (last?.type === "tools") {
    return [...timeline.slice(0, -1), { ...last, items: [...last.items, row] }];
  }
  return [...timeline, { type: "tools", id: `tl-${++timelineCounter}`, items: [row] }];
}

function timelineText(timeline: TimelineItem[], content: string, kind: string | null): TimelineItem[] {
  return [...timeline, { type: "text", id: `tl-${++timelineCounter}`, content, kind }];
}

function timelineClose(timeline: TimelineItem[], to: ActivityItemStatus): TimelineItem[] {
  return timeline.map((item) =>
    item.type === "tools"
      ? {
          ...item,
          items: item.items.map((a) => (a.status === "running" ? { ...a, status: to } : a)),
        }
      : item,
  );
}

const TERMINAL_STATUSES: readonly JobStatus[] = ["done", "failed", "expired"];

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * E26: lifecycle is derived from LIFECYCLE EVENTS ONLY — step names are the
 * agent's own narration and never gate the status machine (the old step-name
 * whitelist locked the UI in `awaiting_input` whenever a phase it didn't
 * know arrived after answers). Any work signal after questions means the
 * worker resumed: back to `running`, clear the question cards.
 */
function resumeIfWaiting(state: JobStreamState): Pick<JobStreamState, "status" | "questions"> {
  if (isTerminalStatus(state.status)) return { status: state.status, questions: state.questions };
  if (state.status === "awaiting_input") return { status: "running", questions: [] };
  return { status: "running", questions: state.questions };
}

/**
 * Applies the CONTENT of one activity/file/message event to the stream
 * collections — the ONE code path shared by the live SSE dispatch and the
 * snapshot transcript replay (E28), so a restored job renders exactly like
 * the one the player watched.
 */
function applyActivityEvent(state: JobStreamState, data: ActivityEventData): JobStreamState {
  const existing = state.activities.find((a) => a.id === data.id);
  const runningStep = state.steps.find((s) => s.status === "running");
  const row: JobActivity = {
    id: data.id,
    kind: data.kind,
    label: data.label,
    detail: data.detail ?? null,
    status: data.status,
    agent: data.agent ?? null,
    // Reasoning/diff body sticks: later updates must not clear it (E27:
    // same rule for the render format and any attached frame preview).
    text: data.text ?? existing?.text ?? null,
    format: data.format ?? existing?.format ?? null,
    preview: data.preview ?? existing?.preview ?? null,
    // First-seen step wins: upserts update in place, never re-section.
    step: existing ? existing.step : (runningStep?.step ?? null),
  };
  return {
    ...state,
    // applyActivity is the shared upsert contract; rows stay JobActivity
    // because `row` (and every existing entry) carries the extra fields.
    activities: applyActivity(state.activities, row) as JobActivity[],
    timeline: timelineUpsert(state.timeline, row),
  };
}

function applyFileEvent(state: JobStreamState, data: FileEventData): JobStreamState {
  // §4.1 v0.4: file materializations render as feed rows, upserted by path
  // so a rewrite ("updated") replaces its "created" row in place.
  const id = `file:${data.path}`;
  const existing = state.activities.find((a) => a.id === id);
  const runningStep = state.steps.find((s) => s.status === "running");
  const kb = Math.max(1, Math.round(data.bytes / 1024));
  const row: JobActivity = {
    id,
    kind: "write",
    label: `${data.action === "created" ? "Created" : "Updated"} ${data.path}`,
    detail: data.note ? `${kb} KB — ${data.note}` : `${kb} KB`,
    status: "done",
    agent: null,
    step: existing ? existing.step : (runningStep?.step ?? null),
  };
  return {
    ...state,
    activities: applyActivity(state.activities, row) as JobActivity[],
    timeline: timelineUpsert(state.timeline, row),
  };
}

function applyMessageEvent(
  state: JobStreamState,
  data: MessageEventData,
  seq: number | null,
): JobStreamState {
  const duplicate = state.messages.some((m) => m.content === data.content && m.seq === seq);
  if (duplicate) return state;
  return {
    ...state,
    messages: [...state.messages, { seq, content: data.content, kind: data.kind ?? null }],
    timeline: timelineText(state.timeline, data.content, data.kind ?? null),
  };
}

/**
 * E28: replay the snapshot's persisted transcript through the SAME event
 * application as live SSE. Each item's data is validated by its SSE payload
 * schema; malformed or unknown items are skipped — a legacy transcript must
 * never break the thread.
 */
function foldTranscript(state: JobStreamState, transcript: JobTranscriptItem[]): JobStreamState {
  let next = state;
  for (const item of transcript) {
    if (item.event === "activity") {
      const parsed = SSE_EVENT_SCHEMAS.activity.safeParse(item.data);
      if (parsed.success) next = applyActivityEvent(next, parsed.data);
    } else if (item.event === "file") {
      const parsed = SSE_EVENT_SCHEMAS.file.safeParse(item.data);
      if (parsed.success) next = applyFileEvent(next, parsed.data);
    } else if (item.event === "message") {
      const parsed = SSE_EVENT_SCHEMAS.message.safeParse(item.data);
      if (parsed.success) next = applyMessageEvent(next, parsed.data, null);
    }
  }
  return next;
}

/** Seed the stream state from a `GET /jobs/{id}` snapshot (deep-link restore). */
export function seedFromSnapshot(job: Job): JobStreamState {
  const seeded: JobStreamState = {
    ...initialJobStreamState,
    status: job.status,
    steps: job.steps.map((s) => ({
      step: s.step,
      label: s.label,
      status: s.status,
      started_at: s.started_at ?? null,
      ended_at: s.ended_at ?? null,
    })),
    questions: job.questions ?? [],
    done:
      job.status === "done" && job.game_id && job.play_url
        ? {
            game_id: job.game_id,
            version_id: "",
            play_url: job.play_url,
            cover_url: null,
            title: "",
          }
        : null,
    failed:
      job.status === "failed" || job.status === "expired"
        ? {
            error_code: job.status,
            error_user_msg:
              job.error_user_msg ??
              (job.status === "expired"
                ? "This one timed out waiting for your answers."
                : "We couldn't finish this one."),
            refunded: true,
          }
        : null,
  };
  // E28: terminal snapshots replay their persisted transcript so the card
  // shows the full story without an SSE connection. Live jobs skip this —
  // their stream replays the same events from seq 0, and folding both would
  // double the narration.
  if (!isTerminalStatus(job.status) || job.transcript.length === 0) return seeded;
  const replayed = foldTranscript(seeded, job.transcript);
  const settle: ActivityItemStatus = job.status === "done" ? "done" : "error";
  return {
    ...replayed,
    activities: closeActivities(replayed.activities, settle),
    timeline: timelineClose(replayed.timeline, settle),
  };
}

/**
 * Pure SSE state machine: applies one typed event to the stream state.
 * Events with a seq at or below `lastEventId` are ignored (dedupe across
 * replay + live overlap). `now` is injectable for tests.
 */
export function applySseEvent(
  state: JobStreamState,
  event: SseEvent,
  now: string = new Date().toISOString(),
): JobStreamState {
  if (event.id !== null && state.lastEventId !== null && event.id <= state.lastEventId) {
    return state;
  }
  const lastEventId = event.id ?? state.lastEventId;

  switch (event.event) {
    case "heartbeat":
      return { ...state, lastEventId };

    case "step": {
      const { step, label, status } = event.data;
      const existing = state.steps.find((s) => s.step === step);
      const steps = existing
        ? state.steps.map((s) =>
            s.step === step
              ? {
                  ...s,
                  label,
                  status,
                  started_at: s.started_at ?? (status !== "pending" ? now : null),
                  ended_at: status === "done" || status === "failed" ? (s.ended_at ?? now) : null,
                }
              : s,
          )
        : [
            ...state.steps,
            {
              step,
              label,
              status,
              started_at: status !== "pending" ? now : null,
              ended_at: status === "done" || status === "failed" ? now : null,
            },
          ];
      return {
        ...state,
        steps,
        ...resumeIfWaiting(state),
        // A new running step invalidates the previous step's progress detail.
        progressDetail: status === "running" ? null : state.progressDetail,
        lastEventId,
      };
    }

    case "questions":
      return {
        ...state,
        status: "awaiting_input",
        questions: event.data.questions,
        lastEventId,
      };

    case "progress":
      return { ...state, progressDetail: event.data.detail, lastEventId };

    case "activity":
      return { ...applyActivityEvent(state, event.data), ...resumeIfWaiting(state), lastEventId };

    case "file":
      return { ...applyFileEvent(state, event.data), lastEventId };

    case "message":
      return { ...applyMessageEvent(state, event.data, event.id), lastEventId };

    case "heal": {
      const duplicate = state.healNotes.some(
        (h) => h.attempt === event.data.attempt && h.summary === event.data.summary,
      );
      return {
        ...state,
        healNotes: duplicate ? state.healNotes : [...state.healNotes, event.data],
        lastEventId,
      };
    }

    case "done":
      return {
        ...state,
        status: "done",
        done: event.data,
        progressDetail: null,
        questions: [],
        steps: state.steps.map((s) =>
          s.status === "done" || s.status === "failed"
            ? s
            : { ...s, status: "done", ended_at: s.ended_at ?? now },
        ),
        activities: closeActivities(state.activities, "done"),
        timeline: timelineClose(state.timeline, "done"),
        lastEventId,
      };

    case "failed":
      return {
        ...state,
        status: "failed",
        failed: event.data,
        progressDetail: null,
        steps: state.steps.map((s) =>
          s.status === "running" ? { ...s, status: "failed", ended_at: s.ended_at ?? now } : s,
        ),
        activities: closeActivities(state.activities, "error"),
        timeline: timelineClose(state.timeline, "error"),
        lastEventId,
      };
  }
}

/** Terminal events settle any still-running activity rows (pulse must stop). */
function closeActivities(activities: JobActivity[], to: ActivityItemStatus): JobActivity[] {
  return activities.map((a) => (a.status === "running" ? { ...a, status: to } : a));
}
