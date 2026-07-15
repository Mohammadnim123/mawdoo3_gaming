"""Public API DTOs.

The blueprint is deliberately absent from every response — it is an internal
artifact. Play URLs are composed here (service origin now, CDN later via
CDN_BASE_URL) so clients never build storage paths themselves.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from generation_service.config.settings import Settings
from generation_service.domain.constraints import (
    INSTRUCTION_MAX_CHARS,
    INSTRUCTION_MIN_CHARS,
    PROMPT_MAX_CHARS,
    PROMPT_MIN_CHARS,
)
from generation_service.domain.entities import Game, GameSummary, GenerationJob


class ErrorInfo(BaseModel):
    code: str
    message: str


class GenerationCreateRequest(BaseModel):
    prompt: str = Field(
        min_length=PROMPT_MIN_CHARS,
        max_length=PROMPT_MAX_CHARS,
        description="The game idea, ar or en",
    )
    locale: Literal["ar", "en"] | None = Field(
        default=None, description="Force the game's default locale (otherwise auto-detected)"
    )


class TweakCreateRequest(BaseModel):
    instruction: str = Field(
        min_length=INSTRUCTION_MIN_CHARS,
        max_length=INSTRUCTION_MAX_CHARS,
        description="Chat-edit instruction in the creator's words, e.g. 'make it faster', 'أصعب'",
    )


class GenerationResponse(BaseModel):
    id: str
    status: str
    stage: str
    prompt: str
    game_id: str | None
    error: ErrorInfo | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_entity(cls, job: GenerationJob) -> GenerationResponse:
        error = None
        if job.error_code:
            error = ErrorInfo(code=job.error_code, message=job.error_message or "")
        return cls(
            id=job.id,
            status=job.status.value,
            stage=job.stage.value,
            prompt=job.prompt,
            game_id=job.game_id,
            error=error,
            created_at=job.created_at,
            updated_at=job.updated_at,
        )


class LocalizedTitle(BaseModel):
    en: str
    ar: str


class GameResponse(BaseModel):
    id: str
    title: LocalizedTitle
    genre: str
    summary: str
    default_locale: str
    prompt: str
    template_version: str
    play_url: str
    created_at: datetime

    @classmethod
    def from_entity(cls, game: Game | GameSummary, settings: Settings) -> GameResponse:
        return cls(
            id=game.id,
            title=LocalizedTitle(en=game.title_en, ar=game.title_ar),
            genre=game.genre,
            summary=game.summary,
            default_locale=game.default_locale,
            prompt=game.prompt,
            template_version=game.template_version,
            play_url=_play_url(game, settings),
            created_at=game.created_at,
        )


class GamesListResponse(BaseModel):
    items: list[GameResponse]
    total: int
    limit: int
    offset: int


def _play_url(game: Game | GameSummary, settings: Settings) -> str:
    cdn = settings.storage.cdn_base_url.rstrip("/")
    if cdn:
        return f"{cdn}/{game.storage_prefix}/index.html"
    base = settings.app.public_base_url.rstrip("/")
    return f"{base}/g/{game.id}/index.html"
