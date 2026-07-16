import type { HTMLAttributes, ReactElement } from "react";
import { accentGradient } from "../tokens";
import { cn } from "../lib/cn";

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  /** 0..max. Omit for an indeterminate shimmer bar. */
  value?: number;
  max?: number;
  /** Gradient fill is reserved for generation moments; defaults to violet. */
  gradient?: boolean;
  label?: string;
}

export function Progress({
  value,
  max = 100,
  gradient = false,
  label,
  className,
  ...rest
}: ProgressProps): ReactElement {
  const clamped = value === undefined ? undefined : Math.min(max, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={clamped}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-2", className)}
      {...rest}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-250 ease-out",
          clamped === undefined && "fp-shimmer w-full",
          !gradient && clamped !== undefined && "bg-violet",
        )}
        style={{
          width: clamped !== undefined ? `${(clamped / max) * 100}%` : undefined,
          backgroundImage: gradient && clamped !== undefined ? accentGradient : undefined,
        }}
      />
    </div>
  );
}
