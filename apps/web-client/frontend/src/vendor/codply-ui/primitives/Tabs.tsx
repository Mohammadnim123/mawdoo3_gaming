"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { HTMLAttributes, KeyboardEvent, ReactElement, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`<${component}> must be used inside <Tabs>`);
  return ctx;
}

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

/** Headless-ish tabs: `<Tabs><TabsList><TabsTrigger/>…</TabsList><TabsContent/></Tabs>` */
export function Tabs({
  value: controlled,
  defaultValue,
  onValueChange,
  children,
  className,
}: TabsProps): ReactElement {
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? "");
  const value = controlled ?? uncontrolled;
  const baseId = useId();
  const setValue = useCallback(
    (v: string) => {
      if (controlled === undefined) setUncontrolled(v);
      onValueChange?.(v);
    },
    [controlled, onValueChange],
  );
  const ctx = useMemo(() => ({ value, setValue, baseId }), [value, setValue, baseId]);
  return (
    <TabsContext.Provider value={ctx}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps extends HTMLAttributes<HTMLDivElement> {
  "aria-label"?: string;
}

export function TabsList({ className, onKeyDown, ...rest }: TabsListProps): ReactElement {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  // The edge fade only makes sense while the row actually scrolls — track it.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Roving focus with arrow keys.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? [],
    );
    if (tabs.length === 0) return;
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else next = tabs.length - 1;
    event.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      data-overflowing={overflowing}
      onKeyDown={handleKeyDown}
      className={cn(
        // fp-scroll-x: single-row horizontal scroller on overflow (snap,
        // hidden scrollbar, edge fade) — tab sets never wrap or clip.
        // w-fit keeps the desktop hug-content look; max-w-full caps it.
        "fp-scroll-x w-fit max-w-full items-center gap-1 rounded-2xl border border-edge bg-surface-1 p-1",
        className,
      )}
      {...rest}
    />
  );
}

export interface TabsTriggerProps {
  value: string;
  icon?: LucideIcon;
  /** Accent hue when active (each tab can carry its own color). */
  accent?: string;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

export function TabsTrigger({
  value,
  icon: Icon,
  accent,
  disabled,
  children,
  className,
}: TabsTriggerProps): ReactElement {
  const { value: active, setValue, baseId } = useTabs("TabsTrigger");
  const selected = active === value;
  const ref = useRef<HTMLButtonElement | null>(null);

  // Keep the active tab visible inside a scrolled TabsList.
  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [selected]);

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => setValue(value)}
      style={selected && accent ? { color: accent, backgroundColor: `${accent}1F` } : undefined}
      className={cn(
        // fp-hit expands the touch target to ≥44px on coarse pointers.
        "fp-hit inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-medium",
        "transition-colors duration-150 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
        "disabled:pointer-events-none disabled:opacity-50",
        selected ? "bg-surface-3 text-ink" : "text-ink-secondary hover:text-ink",
        className,
      )}
    >
      {Icon && <Icon className="size-4" aria-hidden />}
      {children}
    </button>
  );
}

export interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({ value, className, ...rest }: TabsContentProps): ReactElement | null {
  const { value: active, baseId } = useTabs("TabsContent");
  if (active !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      tabIndex={0}
      className={className}
      {...rest}
    />
  );
}
