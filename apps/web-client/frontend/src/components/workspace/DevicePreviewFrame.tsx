"use client";

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { cn } from "@codply/ui";

export interface DevicePreviewFrameProps {
  /** Device CSS-px viewport, or null to fill the panel (desktop). */
  viewport: { w: number; h: number } | null;
  children: ReactNode;
  className?: string;
}

/** Breathing room kept between the device bezel and the panel edges. */
const FIT_PADDING = 24;

/**
 * Frames its child (the live game iframe) at a fixed device viewport and
 * scales it down to fit the available panel — re-fitting on any panel resize
 * (the drag splitter, window resize) via a ResizeObserver. `viewport === null`
 * fills the panel (desktop, unchanged). The child keeps its own identity, so
 * switching device RESIZES the game (real mobile/tablet viewport) rather than
 * remounting it. FLAT: a rounded 1px-ish bezel, zero shadow.
 */
export function DevicePreviewFrame({
  viewport,
  children,
  className,
}: DevicePreviewFrameProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (viewport === null) return;
    const el = containerRef.current;
    if (el === null) return;
    const fit = (): void => {
      const availW = el.clientWidth - FIT_PADDING;
      const availH = el.clientHeight - FIT_PADDING;
      const next = Math.min(1, availW / viewport.w, availH / viewport.h);
      setScale(next > 0 ? next : 1);
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewport?.w, viewport?.h]);

  if (viewport === null) {
    return <div className={cn("h-full w-full", className)}>{children}</div>;
  }

  return (
    <div
      ref={containerRef}
      className={cn("flex h-full w-full items-center justify-center overflow-hidden", className)}
    >
      <div
        style={{ width: viewport.w, height: viewport.h, transform: `scale(${scale})` }}
        className="shrink-0 origin-center overflow-hidden rounded-3xl border-2 border-edge bg-surface-1"
        data-testid="device-frame"
      >
        {children}
      </div>
    </div>
  );
}
