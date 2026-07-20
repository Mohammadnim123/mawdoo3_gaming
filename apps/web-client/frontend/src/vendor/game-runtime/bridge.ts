/**
 * postMessage bridge protocol v1 (CONVENTIONS §8 / 08_security.md §1).
 * Envelope: `{v: 1, type, payload}` where `type` is one of BRIDGE_MESSAGE_TYPES.
 * The parent validates `event.source` (frame identity) + origin ('null' for
 * the sandboxed opaque origin) + this schema; the
 * in-game shim validates `targetOrigin`. This is the ONLY parent↔game channel.
 *
 * E40 screenshot capture: the parent posts `{type:"capture"}` (control, like
 * pause/resume); the in-game shim reads the game's primary <canvas> and replies
 * `{type:"capture:result", payload:{dataUrl}}` — the read runs INSIDE the frame
 * (a sandboxed parent could never read the opaque-origin canvas itself).
 */

export const BRIDGE_VERSION = 1 as const;

export const BRIDGE_MESSAGE_TYPES = [
  "ready",
  "console",
  "score",
  "error",
  "pause",
  "resume",
  "capture",
  "capture:result",
] as const;
export type BridgeMessageType = (typeof BRIDGE_MESSAGE_TYPES)[number];

export type ConsoleLevel = "log" | "info" | "warn" | "error";
const CONSOLE_LEVELS: readonly string[] = ["log", "info", "warn", "error"];

export interface BridgeConsolePayload {
  level: ConsoleLevel;
  message: string;
  /** Stack trace for uncaught errors surfaced through the console shim. */
  stack?: string;
  /** Game-side timestamp, ms since epoch. */
  ts?: number;
}

export interface BridgeScorePayload {
  score: number;
}

export interface BridgeErrorPayload {
  message: string;
  stack?: string;
}

/** Game → parent reply to a `capture` request (E40). */
export interface BridgeCaptureResultPayload {
  /** `canvas.toDataURL("image/png")`, or null when there is no canvas / the
   *  read failed (a tainted canvas, no game rendered yet). Never throws. */
  dataUrl: string | null;
  /** Short reason when `dataUrl` is null (e.g. "no-canvas"). */
  error?: string;
}

export type BridgeEmptyPayload = Record<string, never>;

export type BridgeMessage =
  | { v: typeof BRIDGE_VERSION; type: "ready"; payload: BridgeEmptyPayload }
  | { v: typeof BRIDGE_VERSION; type: "console"; payload: BridgeConsolePayload }
  | { v: typeof BRIDGE_VERSION; type: "score"; payload: BridgeScorePayload }
  | { v: typeof BRIDGE_VERSION; type: "error"; payload: BridgeErrorPayload }
  | { v: typeof BRIDGE_VERSION; type: "pause"; payload: BridgeEmptyPayload }
  | { v: typeof BRIDGE_VERSION; type: "resume"; payload: BridgeEmptyPayload }
  | { v: typeof BRIDGE_VERSION; type: "capture"; payload: BridgeEmptyPayload }
  | { v: typeof BRIDGE_VERSION; type: "capture:result"; payload: BridgeCaptureResultPayload };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strict runtime guard for inbound bridge messages. Rejects anything that is
 * not a v1 envelope with a well-formed payload for its type.
 */
export function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (!isRecord(value)) return false;
  if (value["v"] !== BRIDGE_VERSION) return false;
  const type = value["type"];
  if (typeof type !== "string" || !(BRIDGE_MESSAGE_TYPES as readonly string[]).includes(type)) {
    return false;
  }
  const payload = value["payload"];
  switch (type as BridgeMessageType) {
    case "ready":
    case "pause":
    case "resume":
    case "capture":
      return payload === undefined || isRecord(payload);
    case "capture:result":
      return (
        isRecord(payload) &&
        (payload["dataUrl"] === null || typeof payload["dataUrl"] === "string") &&
        (payload["error"] === undefined || typeof payload["error"] === "string")
      );
    case "console":
      return (
        isRecord(payload) &&
        typeof payload["level"] === "string" &&
        CONSOLE_LEVELS.includes(payload["level"]) &&
        typeof payload["message"] === "string" &&
        (payload["stack"] === undefined || typeof payload["stack"] === "string") &&
        (payload["ts"] === undefined || typeof payload["ts"] === "number")
      );
    case "score":
      return (
        isRecord(payload) &&
        typeof payload["score"] === "number" &&
        Number.isFinite(payload["score"])
      );
    case "error":
      return (
        isRecord(payload) &&
        typeof payload["message"] === "string" &&
        (payload["stack"] === undefined || typeof payload["stack"] === "string")
      );
  }
}

/**
 * Guard + normalization: returns the message with a guaranteed payload object
 * (ready/pause/resume senders may omit it), or null when invalid.
 */
export function parseBridgeMessage(value: unknown): BridgeMessage | null {
  if (!isBridgeMessage(value)) return null;
  if (value.payload === undefined) {
    return { ...value, payload: {} } as BridgeMessage;
  }
  return value;
}

/** Normalize a URL/origin string to a bare origin (`scheme://host[:port]`). */
export function normalizeOrigin(urlOrOrigin: string): string | null {
  try {
    return new URL(urlOrOrigin).origin;
  } catch {
    return null;
  }
}

/**
 * True when a `message` event may come from the game frame.
 *
 * The player iframe is sandboxed WITHOUT `allow-same-origin`, so the game runs
 * in an opaque origin and its messages arrive with the literal origin "null" —
 * that is the expected production case. A concrete CDN origin is also accepted
 * (non-sandboxed embeds, e.g. the QA harness). Origin alone is NOT the security
 * boundary here: callers must also verify `event.source === iframe.contentWindow`,
 * which uniquely identifies our frame.
 */
export function isAllowedOrigin(eventOrigin: string, cdnOrigin: string): boolean {
  if (eventOrigin === "null") return true;
  const expected = normalizeOrigin(cdnOrigin);
  return expected !== null && eventOrigin === expected;
}

/** Outbound control message (parent → game). */
export function makeControlMessage(type: "pause" | "resume" | "capture"): BridgeMessage {
  return { v: BRIDGE_VERSION, type, payload: {} };
}

export interface RequestCaptureOptions {
  /** ms to wait for the game's `capture:result` before resolving null
   *  (default 4000). Heavy 3D games can be mid-frame when asked, and games
   *  published before the capture handler shipped never answer at all — a
   *  bounded wait keeps the caller from hanging either way. */
  timeoutMs?: number;
  /** Window the reply listener attaches to (default `globalThis`) — injectable
   *  for tests. */
  target?: Window;
}

/**
 * Ask the game to screenshot itself (E40): post a `capture` control message and
 * resolve with the game's `canvas.toDataURL("image/png")`, or null when there
 * is no canvas / the game never answers / the read failed. Never rejects.
 *
 * The pixel read happens INSIDE the sandboxed iframe (its own script reading its
 * own canvas) — the parent, being cross-origin to the opaque frame, could never
 * read those pixels itself. Same frame-identity + origin validation as every
 * inbound bridge message.
 */
export function requestCapture(
  iframe: Pick<HTMLIFrameElement, "contentWindow">,
  cdnOrigin: string,
  options: RequestCaptureOptions = {},
): Promise<string | null> {
  const { timeoutMs = 4000, target } = options;
  const view: Window = target ?? (globalThis as unknown as Window);
  const contentWindow = iframe.contentWindow;
  if (!contentWindow) return Promise.resolve(null);

  return new Promise<string | null>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      view.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (event: MessageEvent): void => {
      if (!isAllowedOrigin(event.origin, cdnOrigin)) return;
      // Frame identity is the security boundary (origin is "null" for the
      // sandboxed frame): only OUR iframe's reply is accepted.
      if (event.source !== contentWindow) return;
      const message = parseBridgeMessage(event.data);
      if (!message || message.type !== "capture:result") return;
      finish(message.payload.dataUrl);
    };
    view.addEventListener("message", onMessage);
    timer = setTimeout(() => finish(null), timeoutMs);
    // targetOrigin "*": the sandboxed frame's origin is opaque and can never
    // match a concrete one — safe, we post only to our own iframe.
    contentWindow.postMessage(makeControlMessage("capture"), "*");
  });
}
