"""Shared plumbing for the /api/v1 contract layer.

The React islands consume the exact Codply API contract (see
`frontend/src/vendor/contracts/schemas.ts`). Every response here must parse
against those zod schemas — the shapes below are the contract, not ours to
restyle. Errors always use the envelope `{error, message, details}` where
`error` is one of the ErrorCode strings.
"""

from __future__ import annotations

import functools
import json
from collections.abc import Callable
from typing import Any

from django.http import HttpRequest, JsonResponse
from games.services.generation_api import GenerationApiError

# ErrorCode enum from the contract.
VALIDATION_ERROR = "validation_error"
UNAUTHORIZED = "unauthorized"
FORBIDDEN = "forbidden"
NOT_FOUND = "not_found"
RATE_LIMITED = "rate_limited"
QUOTA_EXCEEDED = "quota_exceeded"
CREDITS_EXHAUSTED = "credits_exhausted"
MODERATION_BLOCKED = "moderation_blocked"
CONFLICT = "conflict"
SERVER_ERROR = "server_error"

_STATUS = {
    VALIDATION_ERROR: 422,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    RATE_LIMITED: 429,
    QUOTA_EXCEEDED: 429,
    CREDITS_EXHAUSTED: 402,
    MODERATION_BLOCKED: 422,
    CONFLICT: 409,
    SERVER_ERROR: 500,
}


class ApiError(Exception):
    """Raise anywhere inside an api view to short-circuit into the envelope."""

    def __init__(self, code: str, message: str, *, status: int | None = None,
                 details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status or _STATUS.get(code, 500)
        self.details = details or {}


def error_response(code: str, message: str, *, status: int | None = None,
                   details: dict[str, Any] | None = None) -> JsonResponse:
    return JsonResponse(
        {"error": code, "message": message, "details": details or {}},
        status=status or _STATUS.get(code, 500),
    )


def engine_error(exc: GenerationApiError) -> ApiError:
    """Map an engine error onto the contract envelope."""
    status = exc.status_code
    if status == 404:
        return ApiError(NOT_FOUND, str(exc))
    if status == 409:
        return ApiError(CONFLICT, str(exc))
    if status == 422:
        return ApiError(VALIDATION_ERROR, str(exc))
    return ApiError(SERVER_ERROR, "The generation service is unavailable.", status=502)


def json_body(request: HttpRequest) -> dict[str, Any]:
    if not request.body:
        return {}
    try:
        payload = json.loads(request.body)
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def api_view(*methods: str, auth: bool = False) -> Callable:
    """Method gate + auth gate + ApiError trapping, contract-envelope style."""

    allowed = {m.upper() for m in methods}

    def decorate(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(request: HttpRequest, *args: Any, **kwargs: Any):
            if request.method not in allowed:
                return error_response(VALIDATION_ERROR, "method not allowed", status=405)
            if auth and not request.user.is_authenticated:
                return error_response(UNAUTHORIZED, "Log in to do that.")
            try:
                return fn(request, *args, **kwargs)
            except ApiError as exc:
                return error_response(exc.code, exc.message, status=exc.status,
                                      details=exc.details)
            except GenerationApiError as exc:
                err = engine_error(exc)
                return error_response(err.code, err.message, status=err.status,
                                      details=err.details)

        return wrapper

    return decorate


def page_params(request: HttpRequest, default_limit: int = 20,
                max_limit: int = 50) -> tuple[int, int]:
    """Contract pagination: opaque cursor (we use a stringified offset) + limit."""
    try:
        offset = max(0, int(request.GET.get("cursor") or 0))
    except ValueError:
        offset = 0
    try:
        limit = min(max_limit, max(1, int(request.GET.get("limit") or default_limit)))
    except ValueError:
        limit = default_limit
    return offset, limit


def paginate(qs_or_list, offset: int, limit: int, serialize: Callable) -> dict[str, Any]:
    rows = list(qs_or_list[offset : offset + limit + 1])
    has_more = len(rows) > limit
    rows = rows[:limit]
    return {
        "items": [serialize(row) for row in rows],
        "next_cursor": str(offset + limit) if has_more else None,
    }


def no_content() -> JsonResponse:
    resp = JsonResponse({}, status=204)
    # JsonResponse insists on a body; a 204 must not carry one.
    resp.content = b""
    return resp
