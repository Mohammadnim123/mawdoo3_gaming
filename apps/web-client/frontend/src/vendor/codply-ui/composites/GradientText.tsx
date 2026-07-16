import type { HTMLAttributes, ReactElement } from "react";
import { accentGradient } from "../tokens";
import { cn } from "../lib/cn";

export type GradientTextProps = HTMLAttributes<HTMLSpanElement>;

/** Violet→cyan gradient text — reserved for generate/CTA hero moments. */
export function GradientText({ className, style, ...rest }: GradientTextProps): ReactElement {
  return (
    <span
      className={cn("bg-clip-text font-display text-transparent", className)}
      style={{ backgroundImage: accentGradient, ...style }}
      {...rest}
    />
  );
}
