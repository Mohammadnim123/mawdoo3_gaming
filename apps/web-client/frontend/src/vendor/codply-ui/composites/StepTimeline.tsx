"use client";

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Wrench, X } from "lucide-react";
import { stepMeta, transition } from "../tokens";
import { resolveIcon } from "../lib/icons";
import { cn } from "../lib/cn";
import { tint } from "../lib/tint";

export type TimelineStepStatus = "pending" | "running" | "done" | "failed";

export interface TimelineStep {
  /** Pipeline step name (STEP_META key: enhancing, planning, assets, …). */
  step: string;
  /** Overrides the STEP_META label (e.g. streamed SSE label). */
  label?: string;
  status: TimelineStepStatus;
  started_at?: string | null;
  ended_at?: string | null;
}

export interface TimelineHeal {
  attempt: number;
  summary: string;
  /** Step to attach the note to; defaults to "qa". */
  step?: string;
}

export interface TimelineAsset {
  url: string;
  label?: string;
  /** Step to attach the thumbnail to; defaults to "assets". */
  step?: string;
}

export interface StepTimelineProps {
  steps: TimelineStep[];
  /** Self-heal events, rendered as friendly amber notes. */
  heals?: TimelineHeal[];
  /** Asset thumbnails that pop in as they land. */
  assets?: TimelineAsset[];
  /** Live progress detail for the running step (SSE `progress`). */
  detail?: string | null;
  /** Localized label per KNOWN step name; default = token table (E33). */
  stepLabel?: (step: string) => string | undefined;
  /** Fallback alt for asset thumbnails; default "Generated asset". */
  assetAlt?: string;
  className?: string;
}

function elapsedLabel(startedAt: string, endedAt: string | null | undefined, now: number): string {
  const start = Date.parse(startedAt);
  const end = endedAt ? Date.parse(endedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * The hero generation timeline: vertical, colorful, animated per-step states
 * (pending / running-shimmer / done-check / failed), elapsed times, amber
 * heal notes and asset thumbnail pops. Purely presentational — feed it the
 * job snapshot / SSE-derived state.
 */
export function StepTimeline({
  steps,
  heals = [],
  assets = [],
  detail,
  stepLabel,
  assetAlt = "Generated asset",
  className,
}: StepTimelineProps): ReactElement {
  const anyRunning = steps.some((s) => s.status === "running");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyRunning]);

  return (
    <ol className={cn("flex flex-col", className)} aria-live="polite" data-testid="step-timeline">
      {steps.map((step, index) => {
        const meta = stepMeta(step.step);
        const label = step.label ?? stepLabel?.(step.step) ?? meta.label;
        const Icon = resolveIcon(meta.icon);
        const isLast = index === steps.length - 1;
        const stepHeals = heals.filter((h) => (h.step ?? "qa") === step.step);
        const stepAssets = assets.filter((a) => (a.step ?? "assets") === step.step);
        const active = step.status === "running";

        return (
          <li key={step.step} className="relative flex gap-3" data-status={step.status}>
            {/* Rail */}
            <div className="flex flex-col items-center">
              <span
                data-testid={`step-icon-${step.step}`}
                style={{
                  color: step.status === "pending" ? undefined : meta.color,
                  borderColor: step.status === "pending" ? undefined : tint(meta.color, 40),
                  backgroundColor: step.status === "pending" ? undefined : tint(meta.color, 10),
                }}
                className={cn(
                  // Compact rail below sm; roomier from sm up.
                  "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-2xl border sm:size-9",
                  step.status === "pending" && "border-edge bg-surface-1 text-ink-muted",
                )}
              >
                {step.status === "done" ? (
                  <Check className="size-4" aria-hidden />
                ) : step.status === "failed" ? (
                  <X className="size-4" aria-hidden />
                ) : (
                  <Icon className={cn("size-4", active && "fp-pulse")} aria-hidden />
                )}
              </span>
              {!isLast && (
                <span
                  aria-hidden
                  className={cn("w-px flex-1", step.status === "done" ? "bg-edge-strong" : "bg-edge")}
                />
              )}
            </div>

            {/* Content */}
            <div className={cn("flex min-w-0 flex-1 flex-col gap-1 pb-4 sm:pb-5", isLast && "pb-0 sm:pb-0")}>
              <div className="flex items-baseline justify-between gap-3">
                <p
                  className={cn(
                    // Wrap instead of truncating — labels stay fully readable at 390px.
                    "min-w-0 break-words text-sm font-medium",
                    step.status === "pending" && "text-ink-muted",
                    step.status === "running" &&
                      "fp-shimmer rounded-md text-ink [background-clip:padding-box]",
                    step.status === "done" && "text-ink-secondary",
                    step.status === "failed" && "text-danger",
                  )}
                >
                  {label}
                </p>
                {step.started_at && step.status !== "pending" && (
                  <span
                    className="shrink-0 font-mono text-xs tabular-nums text-ink-muted"
                    data-testid={`step-elapsed-${step.step}`}
                  >
                    {elapsedLabel(step.started_at, step.ended_at, now)}
                  </span>
                )}
              </div>

              {active && detail && (
                <p className="truncate text-xs text-ink-secondary" data-testid="step-detail">
                  {detail}
                </p>
              )}

              {/* Asset thumbnail pops */}
              {stepAssets.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2">
                  <AnimatePresence>
                    {stepAssets.map((asset) => (
                      <motion.img
                        key={asset.url}
                        src={asset.url}
                        alt={asset.label ?? assetAlt}
                        title={asset.label}
                        initial={{ opacity: 0, scale: 0.6 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.6 }}
                        transition={transition.slow}
                        className="size-10 rounded-xl border border-edge bg-surface-2 object-cover"
                        data-testid="asset-thumb"
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}

              {/* Heal notes — friendly amber language */}
              {stepHeals.map((heal) => (
                <motion.div
                  key={heal.attempt}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={transition.base}
                  className="mt-1 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2"
                  data-testid="heal-note"
                >
                  <Wrench className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                  <p className="text-xs text-warning">{heal.summary}</p>
                </motion.div>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
