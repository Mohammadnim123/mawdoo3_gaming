import type { ReactElement, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface ShimmerTextProps {
  children: ReactNode;
  className?: string;
}

/**
 * A white light-sweep that travels through the letters ("magic shine") —
 * the hero-title effect. Renders the content twice: the visible base keeps
 * its real colors (gradient spans included); an aria-hidden overlay clips a
 * moving white band to the same glyphs. Pure CSS (`.fp-shine-overlay` in
 * styles.css), flat, and silenced by prefers-reduced-motion.
 */
export function ShimmerText({ children, className }: ShimmerTextProps): ReactElement {
  return (
    <span className={cn("relative inline-block", className)} data-testid="shimmer-text">
      <span>{children}</span>
      <span className="fp-shine-overlay absolute inset-0" aria-hidden>
        {children}
      </span>
    </span>
  );
}
