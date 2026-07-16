import type { ReactElement, ReactNode } from "react";
import { cn } from "../lib/cn";

export type NoticeTone = "warning" | "danger" | "info";

export interface NoticeProps {
  tone: NoticeTone;
  children: ReactNode;
  /** Optional action slot (Button/link), pinned at the inline end. */
  action?: ReactNode;
  className?: string;
}

const tones: Record<NoticeTone, string> = {
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-danger/40 bg-danger/10 text-danger",
  info: "border-edge bg-surface-1 text-ink-muted",
};

/** Flat inline callout (E36): tone-tinted border/background, no icon chrome. */
export function Notice({ tone, children, action, className }: NoticeProps): ReactElement {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-sm",
        tones[tone],
        className,
      )}
    >
      <div className="min-w-0 flex-1 text-start">{children}</div>
      {action !== undefined && <div className="ms-auto shrink-0">{action}</div>}
    </div>
  );
}
