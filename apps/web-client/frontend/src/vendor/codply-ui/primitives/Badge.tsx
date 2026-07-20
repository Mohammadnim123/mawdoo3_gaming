import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import { cn } from "../lib/cn";
import { tint } from "../lib/tint";

export type BadgeTone = "neutral" | "violet" | "cyan" | "success" | "warning" | "danger" | "info";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Custom accent hex (genre hues etc.); overrides `tone`. */
  accent?: string;
  leading?: ReactNode;
}

const tones: Record<BadgeTone, string> = {
  neutral: "border-edge bg-surface-2 text-ink-secondary",
  violet: "border-violet/40 bg-violet/10 text-violet",
  cyan: "border-cyan/40 bg-cyan/10 text-cyan",
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-danger/40 bg-danger/10 text-danger",
  info: "border-info/40 bg-info/10 text-info",
};

/** Static status/label pill. */
export function Badge({
  tone = "neutral",
  accent,
  leading,
  className,
  style,
  children,
  ...rest
}: BadgeProps): ReactElement {
  return (
    <span
      style={
        accent
          ? {
              borderColor: tint(accent, 40),
              backgroundColor: tint(accent, 10),
              color: accent,
              ...style,
            }
          : style
      }
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        !accent && tones[tone],
        className,
      )}
      {...rest}
    >
      {leading}
      {children}
    </span>
  );
}
