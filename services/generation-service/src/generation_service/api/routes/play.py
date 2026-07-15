"""Serves stored game bundles through the storage port.

MVP stand-in for the production play path (separate sandbox origin + CDN,
ADR-0003-style). The web client embeds these URLs in a sandboxed iframe
from its own origin, so the cross-origin + sandbox double isolation is real
even in development. Swapping to object storage + CDN removes this route's
traffic without changing its contract.

Caching: bundles are replaced in place on tweaks, so responses use
`no-cache` + ETag — browsers always revalidate (cheap 304s) and a finished
edit is visible on the next load instead of after a stale TTL.
"""

from __future__ import annotations

import hashlib
import mimetypes
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from generation_service.api.deps import get_container
from generation_service.container import Container
from generation_service.domain.entities import game_storage_prefix
from generation_service.domain.errors import NotFoundError

router = APIRouter(prefix="/g", tags=["play"])

_CACHE_CONTROL = "no-cache"
# Defense in depth on top of the client's sandboxed iframe.
_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; connect-src 'none'"
)


@router.get("/{game_id}/{file_path:path}")
async def serve_game_file(
    game_id: str,
    file_path: str,
    request: Request,
    container: Annotated[Container, Depends(get_container)],
) -> Response:
    if not file_path:
        file_path = "index.html"
    if ".." in file_path or file_path.startswith("/"):
        raise NotFoundError("not found")
    data = await container.storage.get(f"{game_storage_prefix(game_id)}/{file_path}")
    etag = f'"{hashlib.sha256(data).hexdigest()[:32]}"'
    headers = {
        "Cache-Control": _CACHE_CONTROL,
        "ETag": etag,
        "Content-Security-Policy": _CSP,
        "X-Content-Type-Options": "nosniff",
    }
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    media_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
    return Response(content=data, media_type=media_type, headers=headers)
