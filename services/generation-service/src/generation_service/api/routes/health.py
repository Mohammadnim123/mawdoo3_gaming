from __future__ import annotations

from fastapi import APIRouter

from generation_service import __version__

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "generation-service", "version": __version__}
