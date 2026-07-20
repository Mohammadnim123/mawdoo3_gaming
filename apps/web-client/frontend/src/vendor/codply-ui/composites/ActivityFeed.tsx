"use client";

import { useState, type ReactElement } from "react";
import { CheckCircle2, ChevronRight, CircleAlert } from "lucide-react";
import { activityKindMeta } from "../tokens";
import { resolveIcon } from "../lib/icons";
import { cn } from "../lib/cn";
import { DiffBlock } from "./DiffBlock";

export type ActivityItemStatus = "running" | "done" | "error";

/** Media attached to a row (E27) — the agent's captured game frame. */
export interface ActivityItemPreview {
  kind: string;
  url: string;
  alt?: string | null;
}

/** One live-activity row — shape matches the SSE `activity` event data. */
export interface ActivityItem {
  /** Stable row key: re-applying the same id updates the row (upsert). */
  id: string;
  /** think|model|asset|read|write|test|fix|publish|shot|… — fallback-safe. */
  kind: string;
  label: string;
  detail?: string | null;
  status: ActivityItemStatus;
  agent?: string | null;
  /** v0.4: optional long-form body (full reasoning summary) — expandable. */
  text?: string | null;
  /** E27: how `text` renders — "diff" colorizes +/− lines. */
  format?: string | null;
  /** E27: inline media — image previews render without a click. */
  preview?: ActivityItemPreview | null;
}

/**
 * Client half of the CONVENTIONS §4.1 activity upsert contract: upsert by
 * `id` preserving first-seen order; latest status/detail wins. Pure — always
 * returns a new array, never mutates the input.
 */
export function applyActivity(items: ActivityItem[], data: ActivityItem): ActivityItem[] {
  const index = items.findIndex((item) => item.id === data.id);
  if (index === -1) return [...items, data];
  const next = items.slice();
  next[index] = { ...next[index], ...data };
  return next;
}

export interface ActivityFeedProps {
  items: ActivityItem[];
  className?: string;
}

/**
 * Live agent-activity rows (E14-F3): pulsing dot while `running` (the global
 * prefers-reduced-motion rule stills it), kind-tinted check on `done`, danger
 * alert on `error`; kind icon + label + muted trailing detail. Rows carrying a
 * long-form `text` body (full reasoning or an edit diff, E27) expand in
 * place; rows carrying an image `preview` show it inline — the player SEES
 * what the agent sees, no click required.
 */
export function ActivityFeed({ items, className }: ActivityFeedProps): ReactElement {
  return (
    <ul className={cn("flex flex-col", className)} aria-live="polite" data-testid="activity-feed">
      {items.map((item) => (
        <ActivityRow key={item.id} item={item} />
      ))}
    </ul>
  );
}

function ActivityRow({ item }: { item: ActivityItem }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const meta = activityKindMeta(item.kind);
  const KindIcon = resolveIcon(meta.icon);
  const expandable = item.text != null && item.text !== "";
  const imagePreview = item.preview != null && item.preview.kind === "image" ? item.preview : null;
  const row = (
    <>
      {/* Status glyph */}
      <span
        className="flex size-4 shrink-0 items-center justify-center"
        data-testid={`activity-status-${item.id}`}
      >
        {item.status === "running" ? (
          <span
            className="fp-pulse size-2 rounded-full"
            style={{ backgroundColor: meta.color }}
            data-testid="activity-running-dot"
            aria-hidden
          />
        ) : item.status === "done" ? (
          <CheckCircle2 className="size-4" style={{ color: meta.color }} aria-hidden />
        ) : (
          <CircleAlert className="size-4 text-danger" aria-hidden />
        )}
        <span className="sr-only">{item.status}</span>
      </span>
      <KindIcon className="size-3.5 shrink-0" style={{ color: meta.color }} aria-hidden />
      <span
        className={cn(
          "min-w-0 truncate text-sm",
          item.status === "error"
            ? "text-danger"
            : item.status === "running"
              ? "text-ink"
              : "text-ink-secondary",
        )}
      >
        {item.label}
      </span>
      {item.detail != null && item.detail !== "" && (
        <span
          className="ms-auto max-w-[55%] shrink-0 truncate text-xs text-ink-muted"
          data-testid={`activity-detail-${item.id}`}
        >
          {item.detail}
        </span>
      )}
    </>
  );

  // E27: captured frames render inline — seeing them is the whole point.
  const media = imagePreview && (
    <a
      href={imagePreview.url}
      target="_blank"
      rel="noreferrer noopener"
      className="mt-1.5 ms-6 block w-fit"
      data-testid={`activity-preview-${item.id}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- job-scoped API frame */}
      <img
        src={imagePreview.url}
        alt={imagePreview.alt ?? item.label}
        loading="lazy"
        className="max-h-44 max-w-full rounded-xl border border-edge object-contain"
      />
    </a>
  );

  if (!expandable) {
    return (
      <li
        data-status={item.status}
        data-kind={item.kind}
        className="min-w-0 py-1"
      >
        <div className="flex min-w-0 items-center gap-2">{row}</div>
        {media}
      </li>
    );
  }

  return (
    <li data-status={item.status} data-kind={item.kind} className="min-w-0 py-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        data-testid={`activity-expand-${item.id}`}
        className="fp-hit -mx-1 flex w-full min-w-0 items-center gap-2 rounded-xl px-1 text-start hover:bg-surface-2"
      >
        {row}
        <ChevronRight
          className={cn(
            "fp-flip-rtl size-3.5 shrink-0 text-ink-muted transition-transform",
            expanded && "rotate-90",
          )}
          aria-hidden
        />
      </button>
      {expanded &&
        (item.format === "diff" ? (
          <div className="mt-1 ms-6" data-testid={`activity-text-${item.id}`}>
            <DiffBlock text={item.text ?? ""} />
          </div>
        ) : (
          <div
            data-testid={`activity-text-${item.id}`}
            className="mt-1 ms-6 max-h-[40vh] overflow-y-auto rounded-xl border border-edge bg-surface-2 p-3 text-xs leading-relaxed whitespace-pre-wrap text-ink-secondary"
          >
            {item.text}
          </div>
        ))}
      {media}
    </li>
  );
}
