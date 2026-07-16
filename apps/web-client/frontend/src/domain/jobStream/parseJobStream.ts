import {
  SSE_EVENT_SCHEMAS,
  SseFramer,
  isSseEventName,
  type SseEvent,
} from "@codply/contracts";

// E26: the wire-drift patches that used to live here ("completed" → "done",
// {id,label} clarify options) are the CONTRACT now — schemas normalize.

function toTypedEvent(frame: { event: string; data: string; id: string | null }): SseEvent | null {
  if (!isSseEventName(frame.event)) return null;
  let json: unknown;
  try {
    json = frame.data === "" ? {} : JSON.parse(frame.data);
  } catch {
    return null; // torn/garbled payload — skip, never kill the stream
  }
  const parsed = SSE_EVENT_SCHEMAS[frame.event].safeParse(json);
  if (!parsed.success) return null; // tolerate unknown payload shapes
  const idNum = frame.id !== null && frame.id !== "" ? Number(frame.id) : NaN;
  return {
    event: frame.event,
    id: Number.isFinite(idNum) ? idNum : null,
    data: parsed.data,
  } as SseEvent;
}

/**
 * Fault-tolerant variant of contracts' `parseSseStream` for the live job
 * stream: same framing (`SseFramer`), but a single malformed event is
 * skipped instead of aborting the whole stream — a dropped progress label
 * must never freeze the build timeline.
 */
export async function* parseJobStream(
  response: Response,
): AsyncGenerator<SseEvent, void, undefined> {
  if (!response.body) {
    throw new Error("SSE response has no body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const framer = new SseFramer();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const frame of framer.push(decoder.decode(value, { stream: true }))) {
        const event = toTypedEvent(frame);
        if (event) yield event;
      }
    }
    for (const frame of framer.push(decoder.decode())) {
      const event = toTypedEvent(frame);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}
