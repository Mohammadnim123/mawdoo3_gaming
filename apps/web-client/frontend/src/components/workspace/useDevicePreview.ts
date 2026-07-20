"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Device-size preview for the workspace game panel (E14): show the live game
 * at a real phone/tablet viewport (so its responsive layout is exercised) or
 * fill the panel on desktop. The selection persists across sessions.
 */
export type DeviceSize = "desktop" | "tablet" | "mobile";
export type Orientation = "portrait" | "landscape";

/** Portrait CSS-px viewports; landscape swaps width/height. */
export const DEVICE_VIEWPORTS: Record<Exclude<DeviceSize, "desktop">, { w: number; h: number }> = {
  tablet: { w: 820, h: 1180 },
  mobile: { w: 390, h: 844 },
};

const DEVICE_KEY = "fp:workspace:preview-device";
const ORIENT_KEY = "fp:workspace:preview-orientation";
const DEVICES: readonly DeviceSize[] = ["desktop", "tablet", "mobile"];

/** Viewport (px) for a device+orientation, or null when it fills the panel. */
export function deviceViewport(
  device: DeviceSize,
  orientation: Orientation,
): { w: number; h: number } | null {
  if (device === "desktop") return null;
  const base = DEVICE_VIEWPORTS[device];
  return orientation === "landscape" ? { w: base.h, h: base.w } : base;
}

export interface DevicePreview {
  device: DeviceSize;
  orientation: Orientation;
  viewport: { w: number; h: number } | null;
  selectDevice: (device: DeviceSize) => void;
  toggleOrientation: () => void;
}

export function useDevicePreview(): DevicePreview {
  const [device, setDevice] = useState<DeviceSize>("desktop");
  const [orientation, setOrientation] = useState<Orientation>("portrait");

  // Hydrate after mount so SSR renders the default (no hydration mismatch).
  useEffect(() => {
    const savedDevice = window.localStorage.getItem(DEVICE_KEY);
    if (savedDevice && (DEVICES as readonly string[]).includes(savedDevice)) {
      setDevice(savedDevice as DeviceSize);
    }
    if (window.localStorage.getItem(ORIENT_KEY) === "landscape") setOrientation("landscape");
  }, []);

  const persist = useCallback((key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private mode / quota — a non-persisted choice is fine */
    }
  }, []);

  const selectDevice = useCallback(
    (next: DeviceSize) => {
      setDevice(next);
      persist(DEVICE_KEY, next);
    },
    [persist],
  );

  const toggleOrientation = useCallback(() => {
    setOrientation((current) => {
      const next = current === "portrait" ? "landscape" : "portrait";
      persist(ORIENT_KEY, next);
      return next;
    });
  }, [persist]);

  return {
    device,
    orientation,
    viewport: deviceViewport(device, orientation),
    selectDevice,
    toggleOrientation,
  };
}
