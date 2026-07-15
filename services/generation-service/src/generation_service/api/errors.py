"""Error → HTTP mapping. One envelope shape for every error.

The documented contract (docs/ARCHITECTURE.md §3.9) is that ALL errors look
like {"error": {"code", "message"}} — including request-validation failures
and unexpected crashes, so clients only ever parse one shape.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from generation_service.domain.errors import (
    ConflictError,
    DomainError,
    FeatureDisabledError,
    InvalidPromptError,
    NotFoundError,
)

logger = logging.getLogger(__name__)

_HTTP_422 = 422  # UNPROCESSABLE_CONTENT; named constant differs across starlette versions

_STATUS_BY_ERROR: list[tuple[type[DomainError], int]] = [
    (NotFoundError, status.HTTP_404_NOT_FOUND),
    (InvalidPromptError, _HTTP_422),
    (ConflictError, status.HTTP_409_CONFLICT),
    (FeatureDisabledError, status.HTTP_403_FORBIDDEN),
]


def _envelope(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def handle_domain_error(request: Request, exc: DomainError) -> JSONResponse:
        http_status = next(
            (code for cls, code in _STATUS_BY_ERROR if isinstance(exc, cls)), 500
        )
        if http_status >= 500:
            logger.error("unhandled domain error on %s: %s", request.url.path, exc.message)
        return JSONResponse(status_code=http_status, content=_envelope(exc.code, exc.message))

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        location = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
        message = f"{location}: {first.get('msg', 'invalid request')}" if location else (
            first.get("msg", "invalid request")
        )
        return JSONResponse(
            status_code=_HTTP_422,
            content=_envelope("validation_error", message),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error on %s", request.url.path)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_envelope("internal_error", "an unexpected error occurred"),
        )
