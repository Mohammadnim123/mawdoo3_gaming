"use client";

import { useRef } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

export interface SegmentedControlProps<T extends string = string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group (e.g. "Asset type"). */
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Exclusive pill group (Images | Audio) with radiogroup semantics: one tab
 * stop, arrow keys move AND select, `aria-checked` marks the active segment.
 */
export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  disabled = false,
  className,
}: SegmentedControlProps<T>): ReactElement {
  const groupRef = useRef<HTMLDivElement | null>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      return;
    }
    const radios = Array.from(
      groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? [],
    );
    if (radios.length === 0) return;
    const current = radios.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (current + 1) % radios.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (current - 1 + radios.length) % radios.length;
    } else if (event.key === "Home") {
      next = 0;
    } else {
      next = radios.length - 1;
    }
    event.preventDefault();
    radios[next]?.focus();
    radios[next]?.click();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn(
        "inline-flex w-fit max-w-full items-center gap-1 rounded-2xl border border-edge bg-surface-1 p-1",
        className,
      )}
    >
      {options.map((option) => {
        const Icon = option.icon;
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              // fp-hit expands the touch target to ≥44px on coarse pointers.
              "fp-hit inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-medium",
              "transition-colors duration-150 ease-out",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
              "disabled:pointer-events-none disabled:opacity-50",
              selected ? "bg-surface-3 text-ink" : "text-ink-secondary hover:text-ink",
            )}
          >
            {Icon && <Icon className="size-4" aria-hidden />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
