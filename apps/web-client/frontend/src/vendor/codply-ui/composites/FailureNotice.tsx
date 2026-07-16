import { Children, type HTMLAttributes, type ReactElement } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "../lib/cn";

export interface FailureNoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Short family headline ("Ran out of budget"). */
  title: string;
  /** The full failure sentence (the server's `error_user_msg`), full-width. */
  description: string;
  /** Optional muted follow-up line (e.g. where the salvaged draft lives). */
  hint?: string;
  /** `children` = the actions row (Buttons); it wraps on narrow cards. */
}

/**
 * A job-failure notice (E29-F2): STACKED, flat, danger-toned — header row
 * (icon + short title), a full-width description paragraph that never gets
 * squeezed into a side column by the action buttons, an optional muted hint
 * line, then the wrapping actions row. Replaces the cramped single-row
 * failed footer.
 */
export function FailureNotice({
  title,
  description,
  hint,
  children,
  className,
  ...rest
}: FailureNoticeProps): ReactElement {
  const actions = Children.toArray(children);
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5",
        className,
      )}
      {...rest}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-danger">
        <CircleAlert className="size-4 shrink-0" aria-hidden />
        {title}
      </p>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
        {description}
      </p>
      {hint !== undefined && <p className="text-xs text-ink-muted">{hint}</p>}
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1" data-testid="failure-actions">
          {children}
        </div>
      )}
    </div>
  );
}
