// Live generation timeline: step rows + progress detail + heal notes +
// thinking indicator (ported from Codply's GenerationCard step list).

import type { ActivityRow, HealNote, StepRow } from "../lib/types";

function StepIcon({ status }: { status: StepRow["status"] }) {
  if (status === "done") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)]">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-danger)]/15 text-[var(--color-danger)]">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center">
      <span className="fp-pulse h-2.5 w-2.5 rounded-full bg-[var(--color-violet)]" />
    </span>
  );
}

export function StepTimeline({
  steps,
  activities,
  heals,
  messages,
  thinking,
  thinkingLabel,
}: {
  steps: StepRow[];
  activities: ActivityRow[];
  heals: HealNote[];
  messages: string[];
  thinking: boolean;
  thinkingLabel: string;
}) {
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {steps.map((step) => (
          <li key={step.step} className="flex items-start gap-3">
            <StepIcon status={step.status} />
            <div className="min-w-0">
              <div
                className={`text-sm ${
                  step.status === "running"
                    ? "fp-shimmer font-medium text-[var(--color-ink)]"
                    : "text-[var(--color-ink-secondary)]"
                }`}
              >
                {step.label}
              </div>
              {step.detail && (
                <div className="truncate text-xs text-[var(--color-ink-muted)]">{step.detail}</div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {activities.length > 0 && (
        <ul className="space-y-1 border-s-2 border-[var(--color-edge-subtle)] ps-3">
          {activities.slice(-8).map((activity) => (
            <li key={activity.id} className="text-xs text-[var(--color-ink-muted)]">
              <span className={activity.status === "running" ? "fp-shimmer" : ""}>
                {activity.label}
              </span>
              {activity.detail && <span className="ms-1 opacity-70">{activity.detail}</span>}
            </li>
          ))}
        </ul>
      )}

      {messages.map((message, i) => (
        <p key={i} className="rounded-xl bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-ink-secondary)]">
          {message}
        </p>
      ))}

      {heals.map((heal) => (
        <p key={heal.attempt} className="flex items-start gap-2 text-xs text-[var(--color-warning)]">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
          <span>{heal.summary}</span>
        </p>
      ))}

      {thinking && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
          <span className="fp-pulse h-2 w-2 rounded-full bg-[var(--color-cyan)]" />
          <span className="fp-shimmer">{thinkingLabel}</span>
        </div>
      )}
    </div>
  );
}
