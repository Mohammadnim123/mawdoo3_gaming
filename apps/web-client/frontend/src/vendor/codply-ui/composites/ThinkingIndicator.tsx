"use client";

import type { ReactElement } from "react";
import { cn } from "../lib/cn";

export interface ThinkingIndicatorProps {
  label?: string;
  className?: string;
}

/**
 * Pulsing "Thinking…" status row for the chat thread (E14-F2). Animation is
 * the shared `fp-pulse` keyframe, stilled globally under
 * `prefers-reduced-motion` (styles.css base layer).
 */
export function ThinkingIndicator({
  label = "Thinking…",
  className,
}: ThinkingIndicatorProps): ReactElement {
  return (
    <div
      role="status"
      className={cn("flex items-center gap-2 text-sm text-ink-secondary", className)}
      data-testid="thinking-indicator"
    >
      <span className="fp-pulse size-2 shrink-0 rounded-full bg-violet" aria-hidden />
      <span className="fp-pulse">{label}</span>
    </div>
  );
}
