"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { transition } from "../tokens";
import { cn } from "../lib/cn";
import { IconButton } from "./IconButton";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Footer slot (actions). */
  footer?: ReactNode;
  /** aria-label of the ✕ button; default "Close dialog" (E33 localizable). */
  closeLabel?: string;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Viewports below this render the Dialog as a bottom sheet (Tailwind `sm`). */
const SHEET_BREAKPOINT = "(max-width: 639px)";

/** SSR-safe media query hook — defaults to `false` before hydration. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, [query]);
  return matches;
}

/**
 * Headless modal dialog: portal, focus trap, Esc/backdrop close, focus
 * restore. Flat glass-free overlay per the design language.
 *
 * Viewport-adaptive: below 640px it renders as a BOTTOM SHEET (rounded top,
 * slides up, drag-down to close, safe-area padding); on larger screens it is
 * the classic centered modal. One component, no per-usage work.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel = "Close dialog",
  className,
}: DialogProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const isSheet = useMediaQuery(SHEET_BREAKPOINT);
  const reducedMotion = useReducedMotion() ?? false;

  // Latest onClose without making it an effect dependency — critical: `onClose`
  // is usually an inline arrow that changes identity on EVERY parent render (e.g.
  // a re-render on each keystroke of a field inside the dialog). If the focus
  // effect below depended on it, every keystroke would tear down + re-run it and
  // yank focus back to the first focusable (the ✕) — you couldn't type.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Initial focus + restore-on-close — runs ONLY when `open` flips, never on an
  // onClose identity change. Prefers an opt-in [data-autofocus] target (e.g. the
  // primary text field) over the DOM-first focusable (which is the ✕).
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>(FOCUSABLE);
    (target ?? panel)?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Esc-to-close + Tab focus trap. Separate from initial focus so it can share
  // the same `[open]` lifetime while reading the latest onClose via the ref.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const panel = panelRef.current;
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const firstEl = focusables[0]!;
      const lastEl = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [open]);

  const handleBackdrop = useCallback(
    (event: React.MouseEvent) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  if (typeof document === "undefined") return null;

  // Sheet slides up from the bottom edge; modal scales in place.
  const panelMotion = isSheet
    ? {
        initial: reducedMotion ? { opacity: 0 } : { y: "100%" as const },
        animate: reducedMotion ? { opacity: 1 } : { y: 0 },
        exit: reducedMotion ? { opacity: 0 } : { y: "100%" as const },
      }
    : {
        initial: { opacity: 0, scale: 0.97, y: 8 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.97, y: 8 },
      };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition.fast}
          onMouseDown={handleBackdrop}
          className={cn(
            "fixed inset-0 z-50 flex bg-canvas/80",
            "items-end justify-center p-0 sm:items-center sm:p-4",
          )}
          data-testid="dialog-backdrop"
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            {...panelMotion}
            transition={transition.base}
            drag={isSheet && !reducedMotion ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (isSheet && (info.offset.y > 96 || info.velocity.y > 600)) onClose();
            }}
            className={cn(
              "flex w-full flex-col border-edge-strong bg-surface-1",
              // Bottom sheet (<sm): rounded top, safe-area padding, own scroll.
              "max-h-[85dvh] rounded-t-2xl border-t p-4 fp-safe-b",
              // Centered modal (≥sm).
              "sm:max-h-[calc(100dvh-2rem)] sm:max-w-md sm:rounded-2xl sm:border sm:p-5",
              className,
            )}
            data-sheet={isSheet || undefined}
          >
            {/* Drag/close affordance — sheet only. */}
            <div
              className="mx-auto mb-3 h-1 w-10 shrink-0 cursor-grab rounded-full bg-edge-strong sm:hidden"
              aria-hidden
              data-testid="dialog-grabber"
            />
            <div className="flex shrink-0 items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className="font-display text-lg font-semibold text-ink">
                  {title}
                </h2>
                {description && (
                  <p id={descriptionId} className="mt-1 text-sm text-ink-secondary">
                    {description}
                  </p>
                )}
              </div>
              <IconButton icon={X} aria-label={closeLabel} variant="ghost" size="sm" onClick={onClose} />
            </div>
            {/* p-1.5 gives child focus rings (outline-offset-2) room so the
                overflow-y-auto scroll box doesn't clip them at its edges; the
                matching -mx-1.5 keeps the content aligned with the title. */}
            {children && (
              <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto p-1.5 -mx-1.5">{children}</div>
            )}
            {footer && <div className="mt-5 flex shrink-0 justify-end gap-2">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
