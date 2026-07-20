import type { ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export interface StatPillProps {
  icon: LucideIcon;
  value: number | string;
  /** Accessible/semantic label, e.g. "plays". */
  label?: string;
  accent?: string;
  className?: string;
}

function formatCount(value: number | string): string {
  if (typeof value === "string") return value;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

/** Icon + compact value (plays, remixes, versions…). */
export function StatPill({ icon: Icon, value, label, accent, className }: StatPillProps): ReactElement {
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs text-ink-secondary", className)}
      aria-label={label ? `${formatCount(value)} ${label}` : undefined}
      title={label}
    >
      <Icon className="size-3.5" style={accent ? { color: accent } : undefined} aria-hidden />
      <span className="tabular-nums">{formatCount(value)}</span>
    </span>
  );
}
