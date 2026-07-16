import { ApiClient } from "@codply/contracts";

export interface ApiGatewayOptions {
  /** Origin the ApiClient targets (it appends `/api/v1` itself). */
  baseUrl: string;
}

/** Django CSRF cookie/header contract (session-cookie auth, same-origin). */
const CSRF_COOKIE = "csrftoken";
const CSRF_HEADER = "X-CSRFToken";

/** Pure `document.cookie` parser for the CSRF token value. */
function parseCsrfCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CSRF_COOKIE) return rest.join("=") || null;
  }
  return null;
}

/**
 * fetch wrapper for the Django backend: every request rides the session
 * cookie (`credentials: "same-origin"`), and mutating requests carry the
 * Django CSRF token read from the `csrftoken` cookie.
 */
function djangoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (method !== "GET" && method !== "HEAD") {
    const token = typeof document !== "undefined" ? parseCsrfCookie(document.cookie) : null;
    if (token) headers[CSRF_HEADER] = token;
  }
  return fetch(input, { ...init, headers, credentials: "same-origin" });
}

/**
 * Thin OOP boundary around the typed `@codply/contracts` ApiClient.
 * Screens never touch the client directly — they consume the services
 * (`AuthService`, `GameService`, `JobService`) which are constructed on
 * top of a gateway.
 *
 * Browser-only in the islands build: baseUrl = window.location.origin →
 * requests hit Django's same-origin `/api/v1/*` with session-cookie auth
 * and the Django CSRF header on non-GET requests.
 */
export class ApiGateway {
  readonly client: ApiClient;

  constructor(options: ApiGatewayOptions) {
    this.client = new ApiClient({ baseUrl: options.baseUrl, fetchImpl: djangoFetch });
  }
}

let browserGateway: ApiGateway | null = null;

/** Singleton gateway for client components (same-origin Django API). */
export function getBrowserGateway(): ApiGateway {
  if (typeof window === "undefined") {
    throw new Error("getBrowserGateway() must only be called in the browser");
  }
  browserGateway ??= new ApiGateway({ baseUrl: window.location.origin });
  return browserGateway;
}
