import type { ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  className?: string;
}

// Same compact notation as StatPill (not exported there — kept in sync).
function formatCount(value: number | string): string {
  if (typeof value === "string") return value;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

/** Flat dashboard stat tile: icon + label row over one big number (E36). */
export function StatCard({ icon: Icon, label, value, className }: StatCardProps): ReactElement {
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border border-edge bg-surface-1 p-4", className)}>
      <span className="flex items-center gap-1.5 text-sm text-ink-muted">
        <Icon className="size-4 shrink-0" aria-hidden />
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums text-ink">{formatCount(value)}</span>
    </div>
  );
}
