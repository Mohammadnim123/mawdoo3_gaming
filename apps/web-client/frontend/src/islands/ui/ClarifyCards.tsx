// One-tap clarifying questions (ported from @codply/ui ClarifyCards):
// MCQ pill rows with preselected smart defaults, a gradient continue button,
// and a "Surprise me" escape hatch that accepts every default.

import { useMemo, useState } from "react";

import type { ClarifyQuestion } from "../lib/types";

export function ClarifyCards({
  questions,
  submitting,
  labels,
  onSubmit,
  onSurpriseMe,
}: {
  questions: ClarifyQuestion[];
  submitting: boolean;
  labels: { title: string; continue: string; surprise: string };
  onSubmit: (answers: Record<string, string>) => void;
  onSurpriseMe: () => void;
}) {
  const defaults = useMemo(() => {
    const map: Record<string, string> = {};
    for (const q of questions) {
      map[q.id] = q.default_option_id || q.options[0]?.id || "";
    }
    return map;
  }, [questions]);
  const [value, setValue] = useState<Record<string, string>>(defaults);

  return (
    <div className="fp-card space-y-4 p-4">
      <div className="text-sm font-medium text-[var(--color-ink)]">{labels.title}</div>
      {questions.map((question) => (
        <fieldset key={question.id} className="space-y-2">
          <legend className="text-sm text-[var(--color-ink-secondary)]">
            {question.question}
          </legend>
          <div className="flex flex-wrap gap-2">
            {question.options.map((option) => {
              const selected = value[question.id] === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={submitting}
                  aria-pressed={selected}
                  onClick={() => setValue((v) => ({ ...v, [question.id]: option.id }))}
                  className={`fp-hit rounded-full border px-3.5 py-1.5 text-sm transition ${
                    selected
                      ? "border-transparent bg-[var(--color-violet)] text-white"
                      : "border-[var(--color-edge)] text-[var(--color-ink-secondary)] hover:border-[var(--color-edge-strong)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          disabled={submitting}
          onClick={() => onSubmit(value)}
          className="fp-btn fp-btn-cta fp-btn-sm"
        >
          {labels.continue}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={onSurpriseMe}
          className="fp-btn fp-btn-ghost fp-btn-sm"
        >
          {labels.surprise}
        </button>
      </div>
    </div>
  );
}
