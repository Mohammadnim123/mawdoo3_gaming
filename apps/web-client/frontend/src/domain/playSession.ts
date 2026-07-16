"use client";

const KEY = "fp_session_hash";

/**
 * Anonymous per-browser-session hash for play dedupe (`POST /games/{id}/play`).
 * Lives in sessionStorage on the *app* origin (the game origin storage ban in
 * 08_security applies to the sandboxed CDN origin, not here).
 */
export function getPlaySessionHash(): string {
  try {
    const existing = window.sessionStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.sessionStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Storage blocked (private mode) — fall back to a per-page hash.
    return crypto.randomUUID();
  }
}
