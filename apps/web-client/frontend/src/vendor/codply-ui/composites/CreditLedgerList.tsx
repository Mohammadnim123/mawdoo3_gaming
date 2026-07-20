import type { ReactElement } from "react";
import { creditKindMeta } from "../tokens";
import { cn } from "../lib/cn";
import { resolveIcon } from "../lib/icons";
import { Button } from "../primitives/Button";

/** One `/me/credits` row as the list needs it (mirrors the wire shape). */
export interface CreditLedgerRow {
  id: string;
  /** Open string on the wire — KNOWN kinds get an icon/label, others fall back. */
  kind: string;
  /** Whole credits: + grants render green, − spends render in default ink. */
  delta: number;
  note?: string | null;
  created_at: string;
}

export interface CreditLedgerListProps {
  rows: CreditLedgerRow[];
  /** Renders a "Load more" button when true. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** Timestamp renderer; defaults to a compact locale date-time. */
  formatTime?: (iso: string) => string;
  /** Row label per wire kind; default = the token table (E33 localizable). */
  kindLabel?: (kind: string) => string;
  /** "Load more" button text; default "Load more". */
  loadMoreLabel?: string;
  /** Empty-ledger line; default "Nothing in the ledger yet.". */
  emptyLabel?: string;
  className?: string;
}

function defaultFormatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "−61" / "+100" with a typographic minus — deltas never render bare. */
export function formatDelta(delta: number): string {
  return delta < 0 ? `−${Math.abs(delta)}` : `+${delta}`;
}

/**
 * The credit ledger (E29): kind icon + human label, optional note, timestamp,
 * and the signed delta on the right. Grants are green; spends stay in ink.
 */
export function CreditLedgerList({
  rows,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  formatTime = defaultFormatTime,
  kindLabel,
  loadMoreLabel = "Load more",
  emptyLabel = "Nothing in the ledger yet.",
  className,
}: CreditLedgerListProps): ReactElement {
  if (rows.length === 0) {
    return (
      <p className={cn("py-4 text-center text-sm text-ink-muted", className)}>{emptyLabel}</p>
    );
  }
  return (
    <div className={cn("flex flex-col", className)}>
      <ul className="flex flex-col" data-testid="credit-ledger">
        {rows.map((row) => {
          const meta = creditKindMeta(row.kind);
          const Icon = resolveIcon(meta.icon);
          return (
            <li
              key={row.id}
              className="flex items-center gap-3 border-b border-edge-subtle py-2.5 last:border-b-0"
            >
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-2"
                style={{ color: meta.color }}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">
                  {kindLabel?.(row.kind) ?? meta.label}
                </span>
                <span className="block truncate text-xs text-ink-muted">
                  {row.note ? `${row.note} · ` : ""}
                  {formatTime(row.created_at)}
                </span>
              </span>
              <span
                dir="ltr"
                className={cn(
                  "shrink-0 text-sm font-semibold tabular-nums",
                  row.delta > 0 ? "text-success" : "text-ink",
                )}
              >
                {formatDelta(row.delta)}
              </span>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          loading={loadingMore}
          onClick={onLoadMore}
          className="mt-1 self-center"
        >
          {loadMoreLabel}
        </Button>
      )}
    </div>
  );
}
