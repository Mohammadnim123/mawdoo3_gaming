import type { HTMLAttributes, ReactElement } from "react";
import { cn } from "../lib/cn";

export type KbdProps = HTMLAttributes<HTMLElement>;

/** Keyboard key hint, JetBrains Mono. */
export function Kbd({ className, ...rest }: KbdProps): ReactElement {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-edge",
        "bg-surface-2 px-1.5 font-mono text-[11px] text-ink-secondary",
        className,
      )}
      {...rest}
    />
  );
}
