"use client";

import type { ReactElement } from "react";
import { motion } from "framer-motion";
import { Check, Dices, MessageCircleQuestion } from "lucide-react";
import { transition } from "../tokens";
import { cn } from "../lib/cn";
import { Button } from "../primitives/Button";

/** The worker's native option shape (E26): answers carry the option `id`. */
export interface ClarifyOption {
  id: string;
  label: string;
}

export interface ClarifyQuestion {
  id: string;
  question: string;
  /** `single_select` renders option pills; `free_text` (or no options) a text box. */
  type: string;
  options: ClarifyOption[];
  default?: string | null;
}

/** User-visible strings — lifted to props so apps can localize (E33). */
export interface ClarifyCardsLabels {
  surpriseMe?: string;
  submit?: string;
  answerPlaceholder?: string;
}

export interface ClarifyCardsProps {
  questions: ClarifyQuestion[];
  /** Chosen answers by question id (option IDs, or free text). */
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  /** Submit the effective answers (defaults merged in). */
  onSubmit?: (answers: Record<string, string>) => void;
  /** "Surprise me" — skip the questions entirely. */
  onSurpriseMe?: () => void;
  submitting?: boolean;
  labels?: ClarifyCardsLabels;
  className?: string;
}

function isFreeText(q: ClarifyQuestion): boolean {
  return q.type === "free_text" || q.options.length === 0;
}

/** Effective answers = explicit choices over question defaults. */
export function effectiveAnswers(
  questions: ClarifyQuestion[],
  value: Record<string, string>,
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const chosen = value[q.id] ?? q.default ?? (isFreeText(q) ? "" : q.options[0]?.id);
    if (chosen !== undefined) answers[q.id] = chosen;
  }
  return answers;
}

/**
 * Clarify cards for `awaiting_input` — tappable MCQ pills with defaults
 * preselected (one tap on "Let's go" always works), a text box for
 * free-text questions (E26), and "Surprise me" to skip entirely.
 */
export function ClarifyCards({
  questions,
  value,
  onChange,
  onSubmit,
  onSurpriseMe,
  submitting = false,
  labels,
  className,
}: ClarifyCardsProps): ReactElement {
  const answers = effectiveAnswers(questions, value);

  return (
    <div className={cn("flex flex-col gap-4", className)} data-testid="clarify-cards">
      {questions.map((q, index) => (
        <motion.fieldset
          key={q.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition.base, delay: index * 0.05 }}
          className="rounded-2xl border border-edge bg-surface-1 p-4"
        >
          <legend className="sr-only">{q.question}</legend>
          <p className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
            <MessageCircleQuestion className="size-4 text-warning" aria-hidden />
            {q.question}
          </p>
          {isFreeText(q) ? (
            <textarea
              value={value[q.id] ?? ""}
              onChange={(e) => onChange({ ...value, [q.id]: e.target.value })}
              disabled={submitting}
              rows={2}
              placeholder={labels?.answerPlaceholder ?? "Type your answer…"}
              aria-label={q.question}
              data-testid={`clarify-text-${q.id}`}
              className={cn(
                "w-full resize-none rounded-2xl border border-edge bg-surface-2 px-3.5 py-2.5",
                "text-sm text-ink placeholder:text-ink-muted",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            />
          ) : (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.question}>
              {q.options.map((option) => {
                const selected = answers[q.id] === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={submitting}
                    onClick={() => onChange({ ...value, [q.id]: option.id })}
                    className={cn(
                      // fp-hit guarantees a ≥44px touch target on coarse pointers.
                      "fp-hit inline-flex h-9 items-center gap-1.5 rounded-2xl border px-3.5 text-sm",
                      "transition-colors duration-150 ease-out",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
                      "disabled:pointer-events-none disabled:opacity-50",
                      selected
                        ? "border-violet bg-violet/15 text-violet"
                        : "border-edge bg-surface-2 text-ink-secondary hover:border-edge-strong hover:text-ink",
                    )}
                  >
                    {selected && <Check className="size-3.5" aria-hidden />}
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
        </motion.fieldset>
      ))}

      {/* Mobile: primary CTA full-width on top; ≥sm: classic side-by-side. */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        {onSurpriseMe && (
          <Button
            variant="ghost"
            onClick={onSurpriseMe}
            disabled={submitting}
            leftIcon={<Dices className="size-4" aria-hidden />}
          >
            {labels?.surpriseMe ?? "Surprise me"}
          </Button>
        )}
        {onSubmit && (
          <Button
            variant="gradient-cta"
            loading={submitting}
            onClick={() => onSubmit(answers)}
            className="w-full sm:ms-auto sm:w-auto"
          >
            {labels?.submit ?? "Let's go"}
          </Button>
        )}
      </div>
    </div>
  );
}
