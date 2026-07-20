"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { transition } from "../tokens";
import { cn } from "../lib/cn";

export type ToastVariant = "info" | "success" | "error";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms; default 4000. */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, "title" | "variant">> {
  id: number;
  description?: string;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

/** Chrome labels — lifted to props so apps can localize (E33). */
export interface ToastProviderLabels {
  /** aria-label of the toast region; default "Notifications". */
  region?: string;
  /** aria-label of the per-toast dismiss button; default "Dismiss notification". */
  dismiss?: string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Access the toast dispatcher; must be under `<ToastProvider>`. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const variantMeta: Record<ToastVariant, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: "text-info" },
  success: { icon: CheckCircle2, className: "text-success" },
  error: { icon: CircleAlert, className: "text-danger" },
};

export function ToastProvider({
  children,
  labels,
}: {
  children: ReactNode;
  labels?: ToastProviderLabels;
}): ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ title, description, variant = "info", duration = 4000 }: ToastOptions) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-3), { id, title, description, variant }]);
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  // Portal the toast region to <body> so `position: fixed` resolves against
  // the viewport. Islands mount inside app chrome (e.g. the top bar carries
  // `backdrop-blur`), and a `backdrop-filter`/`transform` ancestor becomes the
  // containing block for fixed descendants — without the portal the toast
  // pins to that ancestor's box and lands clipped at the top of the screen.
  const region = (
    <div
      aria-live="polite"
      aria-label={labels?.region ?? "Notifications"}
      // --fp-bottom-nav (set by the app shell) lifts toasts above a fixed
      // bottom tab bar; env() keeps them clear of the iOS home indicator.
      style={{
        bottom: "calc(var(--fp-bottom-nav, 0px) + env(safe-area-inset-bottom, 0px) + 1rem)",
      }}
      className="pointer-events-none fixed inset-x-4 z-50 flex flex-col gap-2 sm:inset-x-auto sm:end-4 sm:w-80"
    >
        <AnimatePresence>
          {toasts.map((t) => {
            const Meta = variantMeta[t.variant];
            return (
              <motion.div
                key={t.id}
                role="status"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={transition.base}
                className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-edge-strong bg-surface-2 p-3"
              >
                <Meta.icon className={cn("mt-0.5 size-4 shrink-0", Meta.className)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{t.title}</p>
                  {t.description && (
                    <p className="mt-0.5 text-xs text-ink-secondary">{t.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={labels?.dismiss ?? "Dismiss notification"}
                  onClick={() => dismiss(t.id)}
                  className="fp-hit rounded-md p-0.5 text-ink-muted transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-violet"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
    </div>
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== "undefined" ? createPortal(region, document.body) : region}
    </ToastContext.Provider>
  );
}
