import {
  ApiError,
  oauthStartPath,
  type AuthProvidersResponse,
  type MagicLinkRequestResponse,
  type StatusSentResponse,
  type User,
} from "@codply/contracts";
import type { ApiGateway } from "../gateway";

/**
 * Login/logout flows for the BFF cookie pattern: obtain a JWT from the API,
 * then hand it to `/api/session` which stores it in the httpOnly cookie.
 * Client-side only.
 */
export class AuthService {
  constructor(private readonly gateway: ApiGateway) {}

  /**
   * Dev-first login: tries `/auth/dev-login` and reports whether it is
   * available (404 outside dev) so the login screen can fall back to
   * magic links without an environment flag.
   */
  async devLogin(email: string): Promise<{ user: User } | { unavailable: true }> {
    try {
      const { token, user } = await this.gateway.client.authDevLogin({ email });
      await this.establishSession(token);
      return { user };
    } catch (error) {
      if (ApiError.isApiError(error) && error.status === 404) {
        return { unavailable: true };
      }
      throw error;
    }
  }

  /** Which login methods the API has configured (E37) — public, no auth. */
  providers(): Promise<AuthProvidersResponse> {
    return this.gateway.client.authProviders();
  }

  /** Email+password signup (E37) — enumeration-safe: ALWAYS `{status:"sent"}`.
   * The chosen password only activates once the emailed link is clicked. */
  signup(email: string, password: string): Promise<StatusSentResponse> {
    return this.gateway.client.signup({ email, password });
  }

  /** Email+password login (E37) — 401 carries ONE generic message for every
   * failure mode; banned accounts get 403. */
  async loginPassword(email: string, password: string): Promise<User> {
    const response = await this.gateway.client.loginPassword({ email, password });
    await this.establishSession(response.token);
    return response.user;
  }

  /** Redeem an emailed login token (E37): magic_link or signup purpose —
   * the API dispatches; 401 on bad/expired/used tokens. */
  async verifyToken(token: string): Promise<User> {
    const response = await this.gateway.client.verifyLoginToken({ token });
    await this.establishSession(response.token);
    return response.user;
  }

  /** Request a password-reset email (E37) — enumeration-safe: ALWAYS "sent". */
  forgotPassword(email: string): Promise<StatusSentResponse> {
    return this.gateway.client.forgotPassword({ email });
  }

  /** Redeem a reset token for a new password (E37) — logs the user in and
   * revokes every older JWT (auth epoch bump); 401 on bad/expired/used token. */
  async resetPassword(token: string, password: string): Promise<User> {
    const response = await this.gateway.client.resetPassword({ token, password });
    await this.establishSession(response.token);
    return response.user;
  }

  /** Exchange the one-time code minted by the OAuth callback (E37) for a
   * session; 401 invalid/expired code (60 s TTL, single-use). */
  async oauthComplete(code: string): Promise<User> {
    const response = await this.gateway.client.oauthComplete({ code });
    await this.establishSession(response.token);
    return response.user;
  }

  /** Top-level NAVIGATION to `GET /auth/oauth/{provider}/start` (E37) — the
   * endpoint 302s to the provider, so fetch/XHR would die on CORS. No-op
   * outside the browser (SSR guard). */
  oauthStart(provider: string, next?: string): void {
    if (typeof window === "undefined") return;
    window.location.assign(oauthStartPath(provider, next));
  }

  requestMagicLink(email: string): Promise<MagicLinkRequestResponse> {
    return this.gateway.client.magicLinkRequest({ email });
  }

  async verifyMagicLink(token: string): Promise<User> {
    const response = await this.gateway.client.magicLinkVerify({ token });
    await this.establishSession(response.token);
    return response.user;
  }

  async logout(): Promise<void> {
    const response = await fetch("/api/session", {
      method: "DELETE",
      credentials: "same-origin",
      headers: sessionCsrfHeaders(),
    });
    if (!response.ok) {
      throw new ApiError("server_error", "Could not clear the session.", {}, response.status);
    }
  }

  private async establishSession(token: string): Promise<void> {
    const response = await fetch("/api/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...sessionCsrfHeaders() },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      throw new ApiError("server_error", "Could not establish the session.", {}, response.status);
    }
  }
}

/** Django CSRF header for the session shim — same contract the gateway uses. */
function sessionCsrfHeaders(): Record<string, string> {
  if (typeof document === "undefined") return {};
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "csrftoken") return { "X-CSRFToken": decodeURIComponent(rest.join("=")) };
  }
  return {};
}
