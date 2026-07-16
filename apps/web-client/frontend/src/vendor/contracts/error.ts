import { ErrorEnvelopeSchema, type ErrorCode } from "./schemas";

/**
 * Typed API error carrying the wire envelope (`error`/`message`/`details`)
 * plus the HTTP status. Every non-2xx response from ApiClient throws this.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  readonly status: number;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown>, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }

  /**
   * Build an ApiError from a non-2xx response body. Falls back to a
   * `server_error` envelope when the body is not a valid error envelope.
   */
  static fromResponse(status: number, body: unknown): ApiError {
    const parsed = ErrorEnvelopeSchema.safeParse(body);
    if (parsed.success) {
      return new ApiError(parsed.data.error, parsed.data.message, parsed.data.details, status);
    }
    return new ApiError("server_error", `Request failed with status ${status}`, {}, status);
  }

  static isApiError(err: unknown): err is ApiError {
    return err instanceof ApiError;
  }
}
