"use client";

import type { ButtonHTMLAttributes, ReactElement, Ref } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export type IconButtonVariant = "solid" | "soft" | "ghost" | "danger";
export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  /** Required — icon-only buttons must always have an accessible name. */
  "aria-label": string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

const variants: Record<IconButtonVariant, string> = {
  solid: "border border-edge-strong bg-surface-3 text-ink hover:bg-edge-strong/60",
  soft: "border border-edge bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink",
  ghost: "border border-transparent bg-transparent text-ink-secondary hover:bg-surface-2 hover:text-ink",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
};

const sizes: Record<IconButtonSize, { btn: string; icon: string }> = {
  sm: { btn: "size-8 rounded-xl", icon: "size-4" },
  md: { btn: "size-10 rounded-2xl", icon: "size-4" },
  lg: { btn: "size-12 rounded-2xl", icon: "size-5" },
};

export function IconButton({
  icon: Icon,
  variant = "soft",
  size = "md",
  className,
  type = "button",
  ref,
  ...rest
}: IconButtonProps): ReactElement {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        // fp-hit expands the touch target to ≥44px on coarse pointers.
        "fp-hit inline-flex items-center justify-center transition-colors duration-200 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size].btn,
        className,
      )}
      {...rest}
    >
      <Icon className={sizes[size].icon} aria-hidden />
    </button>
  );
}
