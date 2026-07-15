"""FastAPI dependency resolution — thin lookups into the composition root."""

from __future__ import annotations

from fastapi import Request

from generation_service.container import Container


def get_container(request: Request) -> Container:
    return request.app.state.container
