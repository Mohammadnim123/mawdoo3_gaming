"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Draggable split between the workspace chat column and the Game/Code view
 * (E14). Owns the chat column's px width: pointer-drag on the separator,
 * arrow-key nudge, double-click reset, and localStorage persistence. The
 * width applies on ≥lg only (mobile switches panes instead), so the caller
 * feeds `width` into a `lg:w-[var(--chat-w)]` utility.
 *
 * RTL-aware: in LTR the chat sits at the start (left) and dragging the
 * separator right grows it; under RTL the chat is at the start (right) and
 * the same physical drag must shrink it — so the pointer/keyboard delta is
 * mirrored by `dir`.
 */
const STORAGE_KEY = "fp:workspace:chat-width";
const MIN = 320;
const MAX = 760;
const DEFAULT = 420;
const STEP = 24;

const clamp = (px: number): number => Math.min(MAX, Math.max(MIN, px));

export interface ResizablePane {
  width: number;
  dragging: boolean;
  /** Spread onto the `role="separator"` handle. */
  separatorProps: {
    onPointerDown: (event: React.PointerEvent) => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    onDoubleClick: () => void;
    "aria-valuenow": number;
    "aria-valuemin": number;
    "aria-valuemax": number;
  };
}

export function useResizablePane(dir: "ltr" | "rtl"): ResizablePane {
  const [width, setWidth] = useState(DEFAULT);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(DEFAULT);

  // Hydrate after mount so SSR renders the default (no hydration mismatch).
  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw === null ? NaN : Number(raw);
    if (Number.isFinite(n)) setWidth(clamp(n));
  }, []);

  const persist = useCallback((px: number) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(px));
    } catch {
      /* private mode / quota — a non-persisted width is fine */
    }
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      startX.current = event.clientX;
      startWidth.current = width;
      setDragging(true);
    },
    [width],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent): void => {
      const delta = event.clientX - startX.current;
      const signed = dir === "rtl" ? -delta : delta;
      setWidth(clamp(startWidth.current + signed));
    };
    const onUp = (): void => {
      setDragging(false);
      setWidth((w) => {
        persist(w);
        return w;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, dir, persist]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const grow = dir === "rtl" ? -STEP : STEP;
      let next: number | null = null;
      if (event.key === "ArrowRight") next = width + grow;
      else if (event.key === "ArrowLeft") next = width - grow;
      else if (event.key === "Home") next = MIN;
      else if (event.key === "End") next = MAX;
      if (next === null) return;
      event.preventDefault();
      const clamped = clamp(next);
      setWidth(clamped);
      persist(clamped);
    },
    [width, dir, persist],
  );

  const onDoubleClick = useCallback(() => {
    setWidth(DEFAULT);
    persist(DEFAULT);
  }, [persist]);

  return {
    width,
    dragging,
    separatorProps: {
      onPointerDown,
      onKeyDown,
      onDoubleClick,
      "aria-valuenow": width,
      "aria-valuemin": MIN,
      "aria-valuemax": MAX,
    },
  };
}
