"use client";

import { useId } from "react";
import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "../primitives/Button";
import { Chip } from "../primitives/Chip";
import { Kbd } from "../primitives/Kbd";

export interface PromptComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (prompt: string) => void;
  /** Example prompt chips — clicking one fills the textarea. */
  examples?: string[];
  /** Quota indicator slot, rendered next to the CTA. */
  quotaSlot?: ReactNode;
  minLength?: number;
  maxLength?: number;
  disabled?: boolean;
  /** CTA loading state while the job is being created. */
  generating?: boolean;
  placeholder?: string;
  ctaLabel?: string;
  /** Chrome strings — lifted to props so apps can localize (E33). */
  labels?: {
    /** sr-only textarea label; default "Describe your game". */
    describe?: string;
    /** aria-label of the example-chip row; default "Example prompts". */
    examples?: string;
    /** Text after ⌘↵; default "to generate". */
    toGenerate?: string;
  };
  className?: string;
}

/**
 * The hero prompt box: big textarea, example chips, char counter, quota slot
 * and the gradient Generate CTA (Cmd/Ctrl+Enter submits).
 */
export function PromptComposer({
  value,
  onChange,
  onSubmit,
  examples = [],
  quotaSlot,
  minLength = 3,
  maxLength = 1000,
  disabled = false,
  generating = false,
  placeholder = "Describe the game you want to play… (e.g. “a neon snake that speeds up every apple”)",
  ctaLabel = "Generate game",
  labels,
  className,
}: PromptComposerProps): ReactElement {
  const id = useId();
  const trimmed = value.trim();
  const canSubmit = trimmed.length >= minLength && value.length <= maxLength && !disabled;
  const nearLimit = value.length >= maxLength * 0.9;

  const submit = () => {
    if (canSubmit && !generating) onSubmit(trimmed);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-edge bg-surface-1 p-4",
        "transition-colors duration-200 ease-out focus-within:border-violet",
        className,
      )}
      data-testid="prompt-composer"
    >
      <label htmlFor={id} className="sr-only">
        {labels?.describe ?? "Describe your game"}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={maxLength}
        disabled={disabled || generating}
        placeholder={placeholder}
        rows={4}
        className={cn(
          "min-h-28 w-full resize-none bg-transparent text-base text-ink outline-none",
          "placeholder:text-ink-muted disabled:opacity-50",
        )}
      />

      {examples.length > 0 && (
        // Mobile: one horizontally scrollable row (snap + edge fade);
        // ≥sm: wraps as before. -mx bleeds the scroller to the card edge.
        <div
          className="fp-scroll-x -mx-4 gap-2 px-4 sm:mx-0 sm:flex-wrap sm:overflow-x-visible sm:px-0 sm:[mask-image:none]"
          aria-label={labels?.examples ?? "Example prompts"}
        >
          {examples.map((example) => (
            <Chip
              key={example}
              onClick={() => onChange(example)}
              disabled={disabled || generating}
              leading={<Sparkles className="size-3 text-violet" aria-hidden />}
            >
              {example}
            </Chip>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-edge-subtle pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between gap-3 sm:justify-start">
          <span
            data-testid="char-count"
            aria-live="polite"
            className={cn(
              "font-mono text-xs tabular-nums",
              nearLimit ? "text-warning" : "text-ink-muted",
            )}
          >
            {value.length}/{maxLength}
          </span>
          <span className="hidden items-center gap-1 text-xs text-ink-muted sm:flex">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
            {labels?.toGenerate ?? "to generate"}
          </span>
          <span className="sm:hidden">{quotaSlot}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex">{quotaSlot}</span>
          <Button
            variant="gradient-cta"
            size="lg"
            onClick={submit}
            disabled={!canSubmit}
            loading={generating}
            leftIcon={<Sparkles className="size-4" aria-hidden />}
            className="w-full sm:w-auto"
          >
            {ctaLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
