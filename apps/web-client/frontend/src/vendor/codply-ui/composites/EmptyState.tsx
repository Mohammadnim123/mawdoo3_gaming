import type { ReactElement, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Call-to-action slot (usually a Button). */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-edge",
        "bg-surface-1 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-2xl border border-edge bg-surface-2">
        <Icon className="size-6 text-violet" aria-hidden />
      </span>
      <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
      {description && <p className="max-w-sm text-sm text-ink-secondary">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
