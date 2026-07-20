"use client";

import { useRef } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export interface EditorTab {
  id: string;
  label: string;
  icon?: LucideIcon;
}

export interface EditorTabsProps {
  tabs: EditorTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** User-visible strings — lifted to props so apps can localize (E33). */
  labels?: {
    /** aria-label of the tablist; default "Open files". */
    list?: string;
    /** aria-label template of a close button — `{label}` interpolated. */
    closeTab?: string;
  };
  className?: string;
}

/**
 * Horizontal scrollable editor tabs (E14-F5): active state, per-tab close.
 * The close control is a sibling of the tab button (buttons never nest);
 * arrow keys rove between tabs.
 */
export function EditorTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  labels,
  className,
}: EditorTabsProps): ReactElement {
  const listRef = useRef<HTMLDivElement | null>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? [],
    );
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % buttons.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else next = buttons.length - 1;
    event.preventDefault();
    buttons[next]?.focus();
    buttons[next]?.click();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={labels?.list ?? "Open files"}
      onKeyDown={handleKeyDown}
      className={cn(
        "fp-no-scrollbar flex w-full items-stretch overflow-x-auto border-b border-edge bg-surface-1",
        className,
      )}
      data-testid="editor-tabs"
    >
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        const active = tab.id === activeId;
        // With no active tab the first one stays keyboard-reachable.
        const focusable = active || (activeId == null && index === 0);
        return (
          <div
            key={tab.id}
            className={cn(
              "flex shrink-0 items-center border-e border-edge-subtle",
              active ? "bg-surface-2" : "hover:bg-surface-2/50",
            )}
            data-active={active}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={focusable ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              className={cn(
                "fp-hit flex h-9 items-center gap-1.5 whitespace-nowrap ps-3 pe-1 text-sm",
                "transition-colors duration-150 ease-out",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet",
                active ? "text-ink" : "text-ink-secondary hover:text-ink",
              )}
            >
              {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
              <span className="max-w-40 truncate" dir="ltr">
                {tab.label}
              </span>
            </button>
            <button
              type="button"
              aria-label={(labels?.closeTab ?? "Close {label}").replace("{label}", tab.label)}
              onClick={() => onClose(tab.id)}
              className={cn(
                "fp-hit me-1 flex size-5 items-center justify-center rounded-md",
                "text-ink-muted transition-colors duration-150 ease-out hover:bg-surface-3 hover:text-ink",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet",
              )}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
