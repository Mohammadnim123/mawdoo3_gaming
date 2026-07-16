"use client";

import { useId } from "react";
import type { ReactElement } from "react";
import { cn } from "../lib/cn";

export interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

/** Accessible switch (role="switch", flat track + knob). */
export function Toggle({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
}: ToggleProps): ReactElement {
  const id = useId();
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative h-6 w-11 rounded-full border transition-colors duration-200 ease-out",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
          "disabled:pointer-events-none disabled:opacity-50",
          checked ? "border-violet bg-violet/30" : "border-edge-strong bg-surface-2",
        )}
      >
        <span
          aria-hidden
          className={cn(
            // Logical inset: the knob travels start → end, mirrored under RTL.
            "absolute top-0.5 size-4.5 rounded-full transition-[inset-inline-start] duration-200 ease-out",
            checked ? "start-[calc(100%-1.25rem)] bg-violet" : "start-0.5 bg-ink-muted",
          )}
        />
      </button>
      {label && (
        <label htmlFor={id} className="cursor-pointer text-sm text-ink-secondary">
          {label}
        </label>
      )}
    </span>
  );
}
