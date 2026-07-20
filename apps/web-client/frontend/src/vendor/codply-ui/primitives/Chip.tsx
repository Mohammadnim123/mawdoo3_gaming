"use client";

import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
import { cn } from "../lib/cn";
import { tint } from "../lib/tint";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Selected chips get an accent border + tint; exposed as aria-pressed. */
  selected?: boolean;
  /** Accent color for the selected state; defaults to violet. */
  accent?: string;
  leading?: ReactNode;
}

/** Interactive pill — filters, example prompts, MCQ options. */
export function Chip({
  selected = false,
  accent,
  leading,
  className,
  children,
  style,
  type = "button",
  ...rest
}: ChipProps): ReactElement {
  return (
    <button
      type={type}
      aria-pressed={selected}
      style={
        selected && accent
          ? { borderColor: accent, color: accent, backgroundColor: tint(accent, 12), ...style }
          : style
      }
      className={cn(
        // fp-hit expands the touch target to ≥44px on coarse pointers.
        "fp-hit inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm",
        "transition-colors duration-150 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
        "disabled:pointer-events-none disabled:opacity-50",
        selected
          ? "border-violet bg-violet/15 text-violet"
          : "border-edge bg-surface-2 text-ink-secondary hover:border-edge-strong hover:text-ink",
        className,
      )}
      {...rest}
    >
      {leading}
      {children}
    </button>
  );
}
