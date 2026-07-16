"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

export interface UsePlayTrackingOptions {
  /** Cumulative active seconds before the callback fires. Default 5. */
  thresholdSeconds?: number;
}

export interface PlayTracking {
  /** Start (or resume) accumulating play time. Safe to call repeatedly. */
  start: () => void;
  /** Pause accumulation (tab hidden, game paused). */
  pause: () => void;
  /** Forget everything, allowing the callback to fire again (new session). */
  reset: () => void;
}

/**
 * Tracks cumulative active play time and fires `onPlayedFor(seconds)` exactly
 * once when it crosses the threshold (default ≥5s — the play-count rule in
 * 08_security.md: plays under 5s are ignored).
 */
export function usePlayTracking(
  onPlayedFor?: (seconds: number) => void,
  options?: UsePlayTrackingOptions,
): PlayTracking {
  const threshold = options?.thresholdSeconds ?? 5;
  const callbackRef = useRef(onPlayedFor);
  callbackRef.current = onPlayedFor;

  const accumulatedMsRef = useRef(0);
  const runningSinceRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fire = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    clearTimer();
    const activeMs =
      accumulatedMsRef.current +
      (runningSinceRef.current !== null ? Date.now() - runningSinceRef.current : 0);
    callbackRef.current?.(Math.max(threshold, Math.floor(activeMs / 1000)));
  }, [clearTimer, threshold]);

  const start = useCallback(() => {
    if (firedRef.current || runningSinceRef.current !== null) return;
    runningSinceRef.current = Date.now();
    const remainingMs = Math.max(0, threshold * 1000 - accumulatedMsRef.current);
    clearTimer();
    timerRef.current = setTimeout(fire, remainingMs);
  }, [clearTimer, fire, threshold]);

  const pause = useCallback(() => {
    if (runningSinceRef.current !== null) {
      accumulatedMsRef.current += Date.now() - runningSinceRef.current;
      runningSinceRef.current = null;
    }
    clearTimer();
  }, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    accumulatedMsRef.current = 0;
    runningSinceRef.current = null;
    firedRef.current = false;
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return useMemo(() => ({ start, pause, reset }), [start, pause, reset]);
}
