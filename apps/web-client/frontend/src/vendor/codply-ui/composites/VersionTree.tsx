"use client";

import { useMemo } from "react";
import type { ReactElement } from "react";
import { Eye, GitBranch, History } from "lucide-react";
import { cn } from "../lib/cn";
import { Badge } from "../primitives/Badge";
import { Button } from "../primitives/Button";

export interface VersionNode {
  id: string;
  version_no: number;
  parent_version_id: string | null;
  change_summary: string | null;
  created_at: string;
  play_url: string;
}

export interface VersionTreeProps {
  versions: VersionNode[];
  /** The live version — gets a "current" badge and no rollback action. */
  currentVersionId?: string;
  onPreview?: (version: VersionNode) => void;
  onRollback?: (version: VersionNode) => void;
  /** Disables actions while a rollback job is in flight. */
  busy?: boolean;
  /** User-visible strings — lifted to props so apps can localize (E33). */
  labels?: {
    current?: string;
    preview?: string;
    rollBack?: string;
    noChangeSummary?: string;
  };
  /** Timestamp renderer; defaults to a compact locale date-time. */
  formatWhen?: (iso: string) => string;
  className?: string;
}

function lineageDepth(version: VersionNode, byId: Map<string, VersionNode>): number {
  let depth = 0;
  let cursor: VersionNode | undefined = version;
  const seen = new Set<string>();
  while (cursor?.parent_version_id && !seen.has(cursor.id) && depth < 32) {
    seen.add(cursor.id);
    depth += 1;
    cursor = byId.get(cursor.parent_version_id);
  }
  return depth;
}

function defaultFormatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Version history with lineage indent lines, change summaries and
 * preview/rollback actions (rollback creates a NEW version — immutability).
 */
export function VersionTree({
  versions,
  currentVersionId,
  onPreview,
  onRollback,
  busy = false,
  labels,
  formatWhen = defaultFormatWhen,
  className,
}: VersionTreeProps): ReactElement {
  const byId = useMemo(() => new Map(versions.map((v) => [v.id, v])), [versions]);
  const ordered = useMemo(
    () => [...versions].sort((a, b) => b.version_no - a.version_no),
    [versions],
  );

  return (
    <ol className={cn("flex flex-col gap-2", className)} data-testid="version-tree">
      {ordered.map((version) => {
        const isCurrent = version.id === currentVersionId;
        const depth = lineageDepth(version, byId);
        return (
          <li
            key={version.id}
            // Shallow indent (12px, capped) keeps deep lineages usable at 390px.
            style={{ marginInlineStart: Math.min(depth, 4) * 12 }}
            className={cn(
              // flex-wrap: on narrow rows the actions drop to their own line
              // (thumb-reachable) instead of squeezing the summary.
              "relative flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border p-2.5 sm:p-3",
              depth > 0 &&
                "before:absolute before:-start-3 before:top-1/2 before:h-px before:w-3 before:bg-edge-strong",
              isCurrent ? "border-violet/50 bg-violet/5" : "border-edge bg-surface-1",
            )}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-2xl border sm:size-9",
                isCurrent
                  ? "border-violet/50 bg-violet/15 text-violet"
                  : "border-edge bg-surface-2 text-ink-secondary",
              )}
            >
              <GitBranch className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-ink" dir="ltr">
                  v{version.version_no}
                </span>
                {isCurrent && <Badge tone="violet">{labels?.current ?? "current"}</Badge>}
              </div>
              <p className="truncate text-sm text-ink-secondary">
                {version.change_summary ?? labels?.noChangeSummary ?? "No change summary"}
              </p>
              <p className="font-mono text-xs text-ink-muted">{formatWhen(version.created_at)}</p>
            </div>
            <div className="ms-auto flex shrink-0 items-center gap-1.5">
              {onPreview && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPreview(version)}
                  leftIcon={<Eye className="size-4" aria-hidden />}
                >
                  {labels?.preview ?? "Preview"}
                </Button>
              )}
              {onRollback && !isCurrent && (
                <Button
                  variant="soft"
                  size="sm"
                  disabled={busy}
                  onClick={() => onRollback(version)}
                  leftIcon={<History className="size-4 text-warning" aria-hidden />}
                >
                  {labels?.rollBack ?? "Roll back"}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
