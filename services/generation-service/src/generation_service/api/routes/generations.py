from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from generation_service.api.deps import get_container
from generation_service.api.schemas import GenerationCreateRequest, GenerationResponse
from generation_service.container import Container

router = APIRouter(prefix="/api/v1/generations", tags=["generations"])


@router.post("", status_code=status.HTTP_202_ACCEPTED, response_model=GenerationResponse)
async def start_generation(
    body: GenerationCreateRequest,
    container: Annotated[Container, Depends(get_container)],
) -> GenerationResponse:
    """Accept a prompt and start an async generation job. Poll GET /{id} for progress."""
    job = await container.start_generation.execute(body.prompt, body.locale)
    return GenerationResponse.from_entity(job)


@router.get("/{job_id}", response_model=GenerationResponse)
async def get_generation(
    job_id: str,
    container: Annotated[Container, Depends(get_container)],
) -> GenerationResponse:
    job = await container.get_generation.execute(job_id)
    return GenerationResponse.from_entity(job)
