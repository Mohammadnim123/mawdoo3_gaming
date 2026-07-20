"use client";

import { useId } from "react";
import type { InputHTMLAttributes, ReactElement, ReactNode, Ref } from "react";
import { cn } from "../lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  /** Leading adornment (icon). */
  leading?: ReactNode;
  /** Trailing adornment (E37: e.g. a show/hide password toggle). Unlike
   * `leading` it stays interactive — put a real `<button>` in here. */
  trailing?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function Input({
  label,
  hint,
  error,
  leading,
  trailing,
  className,
  id: idProp,
  ref,
  ...rest
}: InputProps): ReactElement {
  const autoId = useId();
  const id = idProp ?? autoId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-ink-secondary">
          {label}
        </label>
      )}
      <div className="relative">
        {leading && (
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ink-muted">
            {leading}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            // text-base (16px): anything smaller triggers iOS focus zoom.
            "h-11 w-full rounded-2xl border bg-surface-2 px-3 text-base text-ink",
            "placeholder:text-ink-muted transition-colors duration-200 ease-out",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
            "disabled:pointer-events-none disabled:opacity-50",
            leading && "ps-10",
            trailing && "pe-10",
            error ? "border-danger" : "border-edge hover:border-edge-strong",
            className,
          )}
          {...rest}
        />
        {trailing && (
          <span className="absolute inset-y-0 end-3 flex items-center text-ink-muted">
            {trailing}
          </span>
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
