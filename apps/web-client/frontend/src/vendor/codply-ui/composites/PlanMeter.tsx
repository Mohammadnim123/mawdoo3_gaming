import type { ReactElement } from "react";
import { TimerReset } from "lucide-react";
import { cn } from "../lib/cn";
import { Badge } from "../primitives/Badge";
import { Progress } from "../primitives/Progress";

export interface PlanMeterProps {
  /** Credits left in the period (`credits.remaining` on the wire). */
  remaining: number;
  /** Credits spent this period (`credits.used_this_period`). */
  used: number;
  /** Credits granted this period (`credits.period_total`). */
  total: number;
  /** ISO date the period rolls over — rendered as a "Resets <date>" chip. */
  resetsAt?: string | null;
  /** User-visible strings — lifted to props so apps can localize (E33). */
  labels?: {
    remaining?: string;
    used?: string;
    total?: string;
    /** "Resets {date}" template. */
    resets?: string;
    /** aria-label of the usage bar. */
    progress?: string;
  };
  /** Date renderer for the reset chip; defaults to a short locale date. */
  formatDate?: (iso: string) => string;
  /** Number renderer; default en-US grouping (apps pass a locale-bound one). */
  formatNumber?: (value: number) => string;
  className?: string;
}

function defaultFormatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * "Plan Credits" meter (E29): usage bar + "N remaining", "M used / T total"
 * and the period-reset chip. Numbers come straight off `/me/subscription`.
 */
export function PlanMeter({
  remaining,
  used,
  total,
  resetsAt,
  labels,
  formatDate = defaultFormatDate,
  formatNumber = (value) => value.toLocaleString("en-US"),
  className,
}: PlanMeterProps): ReactElement {
  const resetLabel = resetsAt ? formatDate(resetsAt) : "";
  const resetsTemplate = labels?.resets ?? "Resets {date}";
  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="plan-meter">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0">
          <span className="font-display text-2xl font-bold tabular-nums text-ink">
            {formatNumber(remaining)}
          </span>{" "}
          <span className="text-xs text-ink-muted">{labels?.remaining ?? "remaining"}</span>
        </p>
        <p className="shrink-0 text-xs tabular-nums text-ink-muted">
          {formatNumber(used)} {labels?.used ?? "used"} / {formatNumber(total)}{" "}
          {labels?.total ?? "total"}
        </p>
      </div>
      <Progress
        value={used}
        max={Math.max(total, 1)}
        label={labels?.progress ?? "Plan credits used"}
      />
      {resetLabel !== "" && (
        <Badge
          tone="neutral"
          className="self-start"
          leading={<TimerReset className="size-3" aria-hidden />}
        >
          {resetsTemplate.replace("{date}", resetLabel)}
        </Badge>
      )}
    </div>
  );
}
