from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from generation_service.api.deps import get_container
from generation_service.api.schemas import (
    GameResponse,
    GamesListResponse,
    GenerationResponse,
    TweakCreateRequest,
)
from generation_service.container import Container
from generation_service.domain.constraints import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE

router = APIRouter(prefix="/api/v1/games", tags=["games"])


@router.get("", response_model=GamesListResponse)
async def list_games(
    container: Annotated[Container, Depends(get_container)],
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> GamesListResponse:
    page = await container.list_games.execute(limit=limit, offset=offset)
    settings = container.settings
    return GamesListResponse(
        items=[GameResponse.from_entity(game, settings) for game in page.items],
        total=page.total,
        limit=page.limit,
        offset=page.offset,
    )


@router.get("/{game_id}", response_model=GameResponse)
async def get_game(
    game_id: str,
    container: Annotated[Container, Depends(get_container)],
) -> GameResponse:
    game = await container.get_game.execute(game_id)
    return GameResponse.from_entity(game, container.settings)


@router.post(
    "/{game_id}/tweaks", status_code=status.HTTP_202_ACCEPTED, response_model=GenerationResponse
)
async def start_tweak(
    game_id: str,
    body: TweakCreateRequest,
    container: Annotated[Container, Depends(get_container)],
) -> GenerationResponse:
    """Chat-edit an existing game: the pipeline revises its blueprint, regenerates
    the code, re-runs the quality gate, and replaces the game in place on success.
    Poll GET /api/v1/generations/{id} for progress."""
    job = await container.start_tweak.execute(game_id, body.instruction)
    return GenerationResponse.from_entity(job)
