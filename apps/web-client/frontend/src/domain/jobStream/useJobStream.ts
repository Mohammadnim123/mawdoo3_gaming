"use client";

import { useEffect, useRef, useState } from "react";
import { getServices } from "../services";
import { parseJobStream } from "./parseJobStream";
import {
  applySseEvent,
  initialJobStreamState,
  isTerminalStatus,
  seedFromSnapshot,
  type JobStreamState,
} from "./reducer";

export interface UseJobStreamResult extends JobStreamState {
  /** True while the SSE connection is open. */
  connected: boolean;
  /** Transport-level failure after retries were exhausted for this attempt. */
  transportError: boolean;
}

const MAX_BACKOFF_MS = 10_000;

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * The one SSE hook (CONVENTIONS §7): seeds from the job snapshot (deep-link
 * restore), streams `GET /api/jobs/{id}/stream` through the BFF proxy with
 * `fetch` + the contracts SSE framing (fault-tolerant `parseJobStream`),
 * reconnects with `Last-Event-ID` + exponential backoff, and folds every
 * event through the pure reducer.
 */
export function useJobStream(jobId: string | null): UseJobStreamResult {
  const [state, setState] = useState<JobStreamState>(initialJobStreamState);
  const [connected, setConnected] = useState(false);
  const [transportError, setTransportError] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    const { signal } = controller;
    setState(initialJobStreamState);
    setTransportError(false);
    stateRef.current = initialJobStreamState;

    const apply = (updater: (prev: JobStreamState) => JobStreamState): void => {
      stateRef.current = updater(stateRef.current);
      setState(stateRef.current);
    };

    async function run(): Promise<void> {
      // 1. Seed from the snapshot so a reopened tab restores instantly.
      try {
        const job = await getServices().jobs.snapshot(jobId as string, signal);
        if (signal.aborted) return;
        apply(() => seedFromSnapshot(job));
        if (isTerminalStatus(job.status)) return;
      } catch {
        if (signal.aborted) return;
        // Snapshot failing is non-fatal — the stream replays from seq 0.
      }

      // 2. Stream with reconnect + Last-Event-ID resume.
      let attempt = 0;
      while (!signal.aborted) {
        try {
          const headers: Record<string, string> = { Accept: "text/event-stream" };
          const lastEventId = stateRef.current.lastEventId;
          if (lastEventId !== null) headers["Last-Event-ID"] = String(lastEventId);
          const response = await fetch(`/api/jobs/${encodeURIComponent(jobId as string)}/stream`, {
            headers,
            signal,
            cache: "no-store",
          });
          if (!response.ok || response.body === null) {
            throw new Error(`stream responded ${response.status}`);
          }
          setConnected(true);
          setTransportError(false);
          attempt = 0;
          for await (const event of parseJobStream(response)) {
            if (signal.aborted) return;
            apply((prev) => applySseEvent(prev, event));
            if (event.event === "done" || event.event === "failed") return;
          }
          // Server closed without a terminal event → reconnect.
        } catch {
          if (signal.aborted) return;
        }
        setConnected(false);
        if (isTerminalStatus(stateRef.current.status)) return;
        attempt += 1;
        if (attempt >= 4) setTransportError(true);
        await sleep(backoffMs(attempt), signal);
      }
    }

    void run().finally(() => {
      if (!signal.aborted) setConnected(false);
    });

    return () => controller.abort();
  }, [jobId]);

  return { ...state, connected, transportError };
}
