"use client";

import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { CircleAlert, Info, TerminalSquare, TriangleAlert, Wand2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { Chip } from "../primitives/Chip";
import { EmptyState } from "./EmptyState";

export type ConsoleLevel = "log" | "info" | "warn" | "error";

export interface ConsoleEntry {
  id: string;
  level: ConsoleLevel;
  message: string;
  /** ms since epoch (game-side). */
  ts?: number;
  stack?: string;
}

export interface ConsolePaneProps {
  entries: ConsoleEntry[];
  /** "Ask AI to fix" affordance on error rows — pre-fills the studio chat. */
  onAskAiToFix?: (entry: ConsoleEntry) => void;
  /** Cap on rendered rows (oldest dropped from view). Default 500. */
  maxRendered?: number;
  /** User-visible strings — lifted to props so apps can localize (E33).
   * Level names (log/info/warn/error) stay technical console terms. */
  labels?: {
    emptyTitle?: string;
    emptyDescription?: string;
    askAiToFix?: string;
    /** aria-label template for a level chip — `{level}` interpolated. */
    toggleLevel?: string;
  };
  className?: string;
}

const LEVELS: readonly ConsoleLevel[] = ["log", "info", "warn", "error"];

// Accents are var() references (not literal hex): they feed inline `style`
// attributes, which bypass Tailwind — literals would not follow the theme.
const levelMeta: Record<ConsoleLevel, { icon: LucideIcon; accent: string; text: string }> = {
  log: { icon: TerminalSquare, accent: "var(--color-ink-secondary)", text: "text-ink-secondary" },
  info: { icon: Info, accent: "var(--color-info)", text: "text-info" },
  warn: { icon: TriangleAlert, accent: "var(--color-warning)", text: "text-warning" },
  error: { icon: CircleAlert, accent: "var(--color-danger)", text: "text-danger" },
};

function formatTs(ts?: number): string {
  if (ts === undefined) return "";
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

/**
 * Game console viewer: level filter chips with counts, timestamps, stacks
 * and an "Ask AI to fix" action on errors. Renders at most `maxRendered`
 * recent rows to stay fast with chatty games.
 */
export function ConsolePane({
  entries,
  onAskAiToFix,
  maxRendered = 500,
  labels,
  className,
}: ConsolePaneProps): ReactElement {
  const [enabled, setEnabled] = useState<Record<ConsoleLevel, boolean>>({
    log: true,
    info: true,
    warn: true,
    error: true,
  });

  const counts = useMemo(() => {
    const c: Record<ConsoleLevel, number> = { log: 0, info: 0, warn: 0, error: 0 };
    for (const entry of entries) c[entry.level] += 1;
    return c;
  }, [entries]);

  const visible = useMemo(
    () => entries.filter((e) => enabled[e.level]).slice(-maxRendered),
    [enabled, entries, maxRendered],
  );

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col rounded-2xl border border-edge bg-surface-1", className)}
      data-testid="console-pane"
    >
      {/* Filter chips: one scrollable row on phones, wraps from sm up. */}
      <div className="fp-scroll-x items-center gap-2 border-b border-edge-subtle p-2 sm:flex-wrap sm:overflow-x-visible sm:[mask-image:none]">
        {LEVELS.map((level) => {
          const Meta = levelMeta[level];
          return (
            <Chip
              key={level}
              selected={enabled[level]}
              accent={Meta.accent}
              onClick={() => setEnabled((prev) => ({ ...prev, [level]: !prev[level] }))}
              leading={<Meta.icon className="size-3" aria-hidden />}
              aria-label={(labels?.toggleLevel ?? "Toggle {level} messages").replace(
                "{level}",
                level,
              )}
            >
              {level}
              <span className="font-mono text-[10px] tabular-nums opacity-70">{counts[level]}</span>
            </Chip>
          );
        })}
      </div>

      {/* overflow-x-hidden + anywhere-wrapping: log lines can never widen the page.
          dir="ltr": console output is code — an LTR island even in the Arabic UI. */}
      <div
        dir="ltr"
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden text-start font-mono text-xs [overflow-wrap:anywhere]"
        role="log"
        aria-live="polite"
      >
        {visible.length === 0 ? (
          <EmptyState
            icon={TerminalSquare}
            title={labels?.emptyTitle ?? "Nothing logged yet"}
            description={
              labels?.emptyDescription ??
              "Console output from the game shows up here while you play."
            }
            className="m-3 border-0 bg-transparent py-8"
          />
        ) : (
          <ul>
            {visible.map((entry) => {
              const Meta = levelMeta[entry.level];
              return (
                <li
                  key={entry.id}
                  className="group flex items-start gap-2 border-b border-edge-subtle px-3 py-1.5 last:border-b-0"
                  data-level={entry.level}
                >
                  <Meta.icon
                    className="mt-0.5 size-3.5 shrink-0"
                    style={{ color: Meta.accent }}
                    aria-hidden
                  />
                  <span className="shrink-0 tabular-nums text-ink-muted">{formatTs(entry.ts)}</span>
                  <span className={cn("min-w-0 flex-1 whitespace-pre-wrap break-words", Meta.text)}>
                    {entry.message}
                    {entry.stack && (
                      <span className="mt-0.5 block whitespace-pre-wrap text-ink-muted">
                        {entry.stack}
                      </span>
                    )}
                  </span>
                  {entry.level === "error" && onAskAiToFix && (
                    <button
                      type="button"
                      onClick={() => onAskAiToFix(entry)}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-lg border border-violet/40 bg-violet/10",
                        "px-2 py-0.5 font-sans text-[11px] text-violet transition-colors duration-150",
                        "hover:bg-violet/20 focus-visible:outline-2 focus-visible:outline-violet",
                      )}
                    >
                      <Wand2 className="size-3" aria-hidden />
                      {labels?.askAiToFix ?? "Ask AI to fix"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
