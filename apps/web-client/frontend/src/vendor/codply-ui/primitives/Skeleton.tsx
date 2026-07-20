import type { HTMLAttributes, ReactElement } from "react";
import { cn } from "../lib/cn";

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/** Flat loading placeholder (pulse, no shadow). */
export function Skeleton({ className, ...rest }: SkeletonProps): ReactElement {
  return (
    <div
      aria-hidden
      className={cn("fp-pulse rounded-2xl bg-surface-2", className)}
      {...rest}
    />
  );
}
