import type { HTMLAttributes, ReactElement } from "react";
import { cn } from "../lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Raised cards use a stronger surface tone (still flat — border, no shadow). */
  raised?: boolean;
  /** Removes the default padding. */
  flush?: boolean;
}

export function Card({ raised = false, flush = false, className, ...rest }: CardProps): ReactElement {
  return (
    <div
      className={cn(
        "rounded-2xl border border-edge",
        raised ? "bg-surface-2" : "bg-surface-1",
        !flush && "p-4",
        className,
      )}
      {...rest}
    />
  );
}
