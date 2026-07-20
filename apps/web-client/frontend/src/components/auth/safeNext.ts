import type { Route } from "next";

/**
 * Only allow INTERNAL redirect targets from `?next=` — a path that starts with
 * a single `/` followed by a normal path char. Rejects scheme-relative URLs
 * (`//evil.com`) AND the backslash bypass (`/\evil.com`, which browsers fold
 * to `//evil.com`). Shared by the login screen and the OAuth callback (E37).
 */
export function safeNext(raw: string | null): Route {
  // Leading "/" that is NOT followed by another "/" or "\" — the second char
  // must be a real path character for the target to stay same-origin.
  if (raw && /^\/(?![/\\])/.test(raw)) return raw as Route;
  return "/" as Route;
}
