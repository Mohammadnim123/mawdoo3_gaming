"use client";

import type { ButtonHTMLAttributes, ReactElement, ReactNode, Ref } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../lib/cn";

export type ButtonVariant = "gradient-cta" | "solid" | "soft" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
  /** Optional leading icon slot. */
  leftIcon?: ReactNode;
  /** Optional trailing icon slot. */
  rightIcon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

const base =
  // fp-hit expands the touch target to ≥44px on coarse pointers (tokens.TOUCH_TARGET_MIN).
  "fp-hit inline-flex select-none items-center justify-center gap-2 rounded-2xl font-medium " +
  "transition-colors duration-200 ease-out focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-violet " +
  "disabled:pointer-events-none disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  "gradient-cta":
    "border-0 bg-[image:var(--gradient-cta)] text-ink-on-accent hover:opacity-90 active:opacity-80",
  solid: "border border-edge-strong bg-surface-3 text-ink hover:bg-edge-strong/60",
  soft: "border border-edge bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink",
  ghost: "border border-transparent bg-transparent text-ink-secondary hover:bg-surface-2 hover:text-ink",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({
  variant = "solid",
  size = "md",
  loading = false,
  leftIcon,
  rightIcon,
  className,
  children,
  disabled,
  type = "button",
  ref,
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" aria-hidden data-testid="button-spinner" />
      ) : (
        leftIcon
      )}
      {children}
      {rightIcon}
    </button>
  );
}
