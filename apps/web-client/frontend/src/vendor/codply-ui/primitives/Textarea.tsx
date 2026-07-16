"use client";

import { useId } from "react";
import type { ReactElement, Ref, TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  /** Show a live character counter (requires `maxLength`). */
  showCount?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({
  label,
  error,
  showCount = false,
  maxLength,
  className,
  id: idProp,
  value,
  defaultValue,
  ref,
  ...rest
}: TextareaProps): ReactElement {
  const autoId = useId();
  const id = idProp ?? autoId;
  const length = String(value ?? defaultValue ?? "").length;
  const overLimit = maxLength !== undefined && length > maxLength;

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-ink-secondary">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={id}
        value={value}
        defaultValue={defaultValue}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          // text-base (16px): anything smaller triggers iOS focus zoom.
          "min-h-24 w-full resize-y rounded-2xl border bg-surface-2 p-3 text-base text-ink",
          "placeholder:text-ink-muted transition-colors duration-200 ease-out",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
          "disabled:pointer-events-none disabled:opacity-50",
          error ? "border-danger" : "border-edge hover:border-edge-strong",
          className,
        )}
        {...rest}
      />
      <div className="flex items-center justify-between gap-2">
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : (
          <span />
        )}
        {showCount && maxLength !== undefined && (
          <span
            data-testid="char-count"
            className={cn("text-xs tabular-nums", overLimit ? "text-danger" : "text-ink-muted")}
          >
            {length}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
}
