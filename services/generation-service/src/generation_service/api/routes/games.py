from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from generation_service.api.deps import get_container
from generation_service.api.schemas import (
    GameResponse,
    GamesListResponse,
    GameVersionResponse,
    GameVersionsListResponse,
    GenerationResponse,
    RollbackRequest,
    RollbackResponse,
    SourceEditRequest,
    SourceEditResponse,
    TweakCreateRequest,
    VersionSourceResponse,
    play_url_for_prefix,
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
    the code, re-runs the quality gate, and publishes a NEW immutable version on
    success. An optional image_base64 attaches a reference image to the edit.
    Poll GET /api/v1/generations/{id} for progress."""
    job = await container.start_tweak.execute(
        game_id, body.instruction, image_base64=body.image_base64
    )
    return GenerationResponse.from_entity(job)


@router.put(
    "/{game_id}/source",
    status_code=status.HTTP_201_CREATED,
    response_model=SourceEditResponse,
)
async def put_source(
    game_id: str,
    body: SourceEditRequest,
    container: Annotated[Container, Depends(get_container)],
) -> SourceEditResponse:
    """Hand-edit the game's source: the edited game.js/game.css runs through
    the static validation gate (no LLM), is re-assembled against the stored
    blueprint, and lands as a new immutable current version. 422 with
    error.details.findings [{rule, line, snippet}] when the gate rejects."""
    game, version = await container.edit_source.execute(game_id, body.game_js, body.game_css)
    return SourceEditResponse(
        version_id=version.id,
        play_url=play_url_for_prefix(version.storage_prefix, container.settings),
    )


@router.get("/{game_id}/versions", response_model=GameVersionsListResponse)
async def list_versions(
    game_id: str,
    container: Annotated[Container, Depends(get_container)],
) -> GameVersionsListResponse:
    """Immutable version history for one game (oldest first)."""
    game, versions = await container.list_versions.execute(game_id)
    settings = container.settings
    return GameVersionsListResponse(
        items=[GameVersionResponse.from_entity(v, settings) for v in versions],
        current_version_id=game.current_version_id,
    )


@router.get("/{game_id}/versions/{version_id}/source", response_model=VersionSourceResponse)
async def get_version_source(
    game_id: str,
    version_id: str,
    container: Annotated[Container, Depends(get_container)],
) -> VersionSourceResponse:
    """One version's human-readable bundle files (the Code view)."""
    source = await container.get_version_source.execute(game_id, version_id)
    return VersionSourceResponse(**source)


@router.post("/{game_id}/rollback", response_model=RollbackResponse)
async def rollback(
    game_id: str,
    body: RollbackRequest,
    container: Annotated[Container, Depends(get_container)],
) -> RollbackResponse:
    """Make an older immutable version current again (pointer flip — the
    bundle is already stored; nothing is rebuilt)."""
    game, version = await container.rollback.execute(game_id, body.version_id)
    return RollbackResponse(
        version_id=version.id,
        version_no=version.version_no,
        play_url=play_url_for_prefix(version.storage_prefix, container.settings),
    )
