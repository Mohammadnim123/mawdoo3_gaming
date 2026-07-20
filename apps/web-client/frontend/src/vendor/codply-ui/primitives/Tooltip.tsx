"use client";

import { useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface TooltipProps {
  content: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
  className?: string;
}

/** Logical positioning: "left"/"right" mean start/end and mirror under RTL. */
const sides: Record<NonNullable<TooltipProps["side"]>, string> = {
  top: "bottom-full start-1/2 mb-2 -translate-x-1/2 rtl:translate-x-1/2",
  bottom: "top-full start-1/2 mt-2 -translate-x-1/2 rtl:translate-x-1/2",
  left: "end-full top-1/2 me-2 -translate-y-1/2",
  right: "start-full top-1/2 ms-2 -translate-y-1/2",
};

/** CSS-positioned tooltip shown on hover and keyboard focus. */
export function Tooltip({ content, side = "top", children, className }: TooltipProps): ReactElement {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      aria-describedby={visible ? id : undefined}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            "pointer-events-none absolute z-40 whitespace-nowrap rounded-xl border border-edge-strong",
            "bg-surface-3 px-2.5 py-1 text-xs text-ink",
            sides[side],
            className,
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
