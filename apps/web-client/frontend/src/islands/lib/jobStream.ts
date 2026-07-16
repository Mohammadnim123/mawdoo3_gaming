// SSE → state reducer + EventSource hook for one generation job.
//
// Ported from Codply's jobStream design: a pure reducer over typed events
// (dedup by seq, activity upsert by id, steps upsert by step key) driven by
// a reconnecting EventSource. The browser reconnects with Last-Event-ID
// automatically; the engine's persisted log replays losslessly.

import { useEffect, useMemo, useRef, useState } from "react";

import type { JobStreamState, StepRow } from "./types";

export const initialStreamState: JobStreamState = {
  phase: "connecting",
  steps: [],
  activities: [],
  heals: [],
  messages: [],
  questions: [],
  doneGameId: null,
  doneTitle: null,
  errorMessage: null,
  errorCode: null,
  lastSeq: 0,
};

type SseLike = { event: string; seq: number; data: Record<string, unknown> };

export function applySseEvent(state: JobStreamState, ev: SseLike): JobStreamState {
  if (ev.seq && ev.seq <= state.lastSeq) return state; // replayed duplicate
  const next: JobStreamState = { ...state, lastSeq: ev.seq || state.lastSeq };
  const d = ev.data;

  switch (ev.event) {
    case "step": {
      const key = String(d.step ?? "");
      const row: StepRow = {
        step: key,
        label: String(d.label ?? key),
        status: (String(d.status ?? "running") === "completed"
          ? "done"
          : (d.status as StepRow["status"])) || "running",
      };
      const steps = [...next.steps];
      const idx = steps.findIndex((s) => s.step === key);
      if (idx >= 0) steps[idx] = { ...steps[idx], ...row };
      else {
        // A new step starting closes the previous running one.
        for (let i = 0; i < steps.length; i += 1) {
          if (steps[i].status === "running") steps[i] = { ...steps[i], status: "done" };
        }
        steps.push(row);
      }
      next.steps = steps;
      next.phase = "running";
      return next;
    }
    case "progress": {
      const key = String(d.step ?? "");
      next.steps = next.steps.map((s) =>
        s.step === key ? { ...s, detail: String(d.detail ?? "") } : s,
      );
      return next;
    }
    case "activity": {
      const id = String(d.id ?? `a${ev.seq}`);
      const row = {
        id,
        kind: d.kind ? String(d.kind) : undefined,
        label: String(d.label ?? ""),
        detail: d.detail ? String(d.detail) : undefined,
        status: (d.status as "running" | "done" | "error" | undefined) ?? undefined,
      };
      const activities = [...next.activities];
      const idx = activities.findIndex((a) => a.id === id);
      if (idx >= 0) activities[idx] = { ...activities[idx], ...row };
      else activities.push(row);
      next.activities = activities;
      return next;
    }
    case "message": {
      const content = String(d.content ?? "").trim();
      if (content) next.messages = [...next.messages, content];
      return next;
    }
    case "heal": {
      next.heals = [
        ...next.heals,
        { attempt: Number(d.attempt ?? next.heals.length + 1), summary: String(d.summary ?? "") },
      ];
      return next;
    }
    case "questions": {
      next.questions = Array.isArray(d.questions) ? (d.questions as never) : [];
      next.phase = "awaiting_input";
      return next;
    }
    case "done": {
      next.phase = "done";
      next.doneGameId = d.game_id ? String(d.game_id) : null;
      next.doneTitle = d.title_en ? String(d.title_en) : null;
      next.steps = next.steps.map((s) =>
        s.status === "running" ? { ...s, status: "done" } : s,
      );
      return next;
    }
    case "failed": {
      next.phase = "failed";
      next.errorMessage = String(d.error_user_msg ?? d.error_code ?? "generation failed");
      next.errorCode = d.error_code ? String(d.error_code) : null;
      next.steps = next.steps.map((s) =>
        s.status === "running" ? { ...s, status: "failed" } : s,
      );
      return next;
    }
    default:
      return next;
  }
}

const EVENT_NAMES = [
  "step",
  "progress",
  "activity",
  "file",
  "message",
  "heal",
  "questions",
  "done",
  "failed",
] as const;

export function useJobStream(streamUrl: string | null) {
  const [state, setState] = useState<JobStreamState>(initialStreamState);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!streamUrl) return undefined;
    setState(initialStreamState);
    const source = new EventSource(streamUrl);
    sourceRef.current = source;

    const handle = (name: string) => (raw: MessageEvent<string>) => {
      let data: Record<string, unknown> = {};
      try {
        data = raw.data ? JSON.parse(raw.data) : {};
      } catch {
        return; // one malformed frame never kills the stream
      }
      const seq = Number(raw.lastEventId || 0);
      setState((prev) => {
        const next = applySseEvent(prev, { event: name, seq, data });
        if (name === "done" || name === "failed") source.close();
        return next;
      });
    };

    const listeners = EVENT_NAMES.map((name) => {
      const fn = handle(name);
      source.addEventListener(name, fn as EventListener);
      return [name, fn] as const;
    });

    return () => {
      listeners.forEach(([name, fn]) =>
        source.removeEventListener(name, fn as EventListener),
      );
      source.close();
      sourceRef.current = null;
    };
  }, [streamUrl]);

  return useMemo(
    () => ({ ...state, isTerminal: state.phase === "done" || state.phase === "failed" }),
    [state],
  );
}
