"""Service-to-service authentication for the API routers.

The generation-service is only ever called by the Django web tier. When a
``SERVICE_TOKEN`` is configured, every ``/api/v1`` request must carry a matching
``X-Service-Token`` header. When it is empty (local dev), the check is disabled
so the open-by-default developer experience is unchanged.
"""

from __future__ import annotations

import secrets

from fastapi import Header, HTTPException

from generation_service.config.settings import get_settings


async def require_service_token(x_service_token: str | None = Header(default=None)) -> None:
    expected = get_settings().security.service_token
    if not expected:
        return  # auth disabled (dev)
    if not x_service_token or not secrets.compare_digest(x_service_token, expected):
        raise HTTPException(
            status_code=401,
            detail={"error": {"code": "unauthorized", "message": "invalid service token"}},
        )
