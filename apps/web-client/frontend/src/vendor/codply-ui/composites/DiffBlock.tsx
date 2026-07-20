import type { ReactElement } from "react";
import { cn } from "../lib/cn";

export interface DiffBlockProps {
  /** Unified-diff body (hunk headers + +/− lines, no ---/+++ file header). */
  text: string;
  className?: string;
}

type LineTone = "add" | "remove" | "hunk" | "context";

function toneFor(line: string): LineTone {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "remove";
  return "context";
}

const TONE_CLASSES: Record<LineTone, string> = {
  add: "bg-success/10 text-success",
  remove: "bg-danger/10 text-danger",
  hunk: "text-cyan",
  context: "text-ink-secondary",
};

/**
 * Colorized unified diff (E27): the agent's Write/Edit tool calls render as
 * reviewable change bodies — green additions, red removals, cyan hunk
 * markers — in the flat, token-driven style (no syntax engine needed; the
 * diff structure itself is the information).
 */
export function DiffBlock({ text, className }: DiffBlockProps): ReactElement {
  return (
    // dir="ltr": diffs are code — an LTR island even in the Arabic UI (E33).
    <pre
      dir="ltr"
      data-testid="diff-block"
      className={cn(
        "max-h-[40vh] overflow-auto rounded-xl border border-edge bg-canvas p-2 text-start",
        "font-mono text-xs leading-relaxed",
      )}
    >
      {text.split("\n").map((line, i) => (
        <div
          key={i}
          data-tone={toneFor(line)}
          className={cn("whitespace-pre-wrap break-all rounded px-1", TONE_CLASSES[toneFor(line)], className)}
        >
          {line === "" ? " " : line}
        </div>
      ))}
    </pre>
  );
}
