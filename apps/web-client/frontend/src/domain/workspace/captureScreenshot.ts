/**
 * Game screenshot capture strategy (E40).
 *
 * "Screenshot the game" must show EXACTLY what the player is looking at right
 * now — their score, the game-over screen, that one glitchy frame. So we prefer
 * the LIVE in-frame capture: the game's own bridge shim reads its canvas inside
 * the sandboxed iframe (the parent can't reach the opaque-origin pixels itself).
 *
 * A server-side render is the FALLBACK, not the default: it faithfully renders
 * the game but as a fresh session (a different moment), and it's the only thing
 * that works for older immutable game versions whose shim can't self-capture.
 * Layering the two gives "exactly what you see" whenever possible, and "always
 * something" otherwise.
 */

export interface CaptureSources {
  /** Live in-frame capture bound to the mounted player, or null when no game is
   *  ready. Resolves a PNG data URL, or null when the game can't answer (older
   *  shim / no canvas) — it never throws. */
  live: (() => Promise<string | null>) | null;
  /** Server-side render of the current published version (a fresh session).
   *  Throws on failure (surfaced to the caller as the capture error). */
  server: () => Promise<string>;
}

/**
 * Resolve to a screenshot data URL: the live frame when the game can produce it
 * (exact), else the server render (universal). Only the server path can reject.
 */
export async function captureGameScreenshot({ live, server }: CaptureSources): Promise<string> {
  if (live) {
    try {
      const frame = await live();
      if (frame) return frame;
    } catch {
      // A live-capture failure is never fatal — fall through to the server.
    }
  }
  return server();
}
