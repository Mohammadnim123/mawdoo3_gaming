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
from generation_service.domain.entities import (
    ClarifyQuestion,
    Game,
    GameSummary,
    GameVersion,
    GenerationJob,
    JobStatus,
)


class ErrorInfo(BaseModel):
    code: str
    message: str


class GenerationOptions(BaseModel):
    skip_questions: bool = Field(
        default=False,
        description="Skip the clarifying-questions pause and design with smart defaults",
    )


class GenerationCreateRequest(BaseModel):
    prompt: str = Field(
        min_length=PROMPT_MIN_CHARS,
        max_length=PROMPT_MAX_CHARS,
        description="The game idea, ar or en",
    )
    locale: Literal["ar", "en"] | None = Field(
        default=None, description="Force the game's default locale (otherwise auto-detected)"
    )
    options: GenerationOptions = Field(default_factory=GenerationOptions)


class AnswersRequest(BaseModel):
    answers: dict[str, str] = Field(
        default_factory=dict,
        description="Question id -> chosen option id (or short free text). "
        "Empty = accept every default ('Surprise me').",
    )


class TweakCreateRequest(BaseModel):
    instruction: str = Field(
        min_length=INSTRUCTION_MIN_CHARS,
        max_length=INSTRUCTION_MAX_CHARS,
        description="Chat-edit instruction in the creator's words, e.g. 'make it faster', 'أصعب'",
    )
    image_base64: str | None = Field(
        default=None,
        max_length=8_000_000,
        description=(
            "Optional reference image for the edit (screenshot/mockup): raw "
            "base64 or a data-URL. Normalized server-side (1568px long edge, "
            "WebP) and shown to the model alongside the instruction."
        ),
    )


class GenerationResponse(BaseModel):
    id: str
    status: str
    stage: str
    prompt: str
    game_id: str | None
    error: ErrorInfo | None
    questions: list[ClarifyQuestion] = Field(default_factory=list)
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
            questions=job.questions if job.status == JobStatus.AWAITING_INPUT else [],
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
    cover_url: str | None = None
    created_at: datetime

    @classmethod
    def from_entity(cls, game: Game | GameSummary, settings: Settings) -> GameResponse:
        cover_url = (
            bundle_file_url(game.storage_prefix, game.cover_file, settings)
            if game.cover_file
            else None
        )
        return cls(
            id=game.id,
            title=LocalizedTitle(en=game.title_en, ar=game.title_ar),
            genre=game.genre,
            summary=game.summary,
            default_locale=game.default_locale,
            prompt=game.prompt,
            template_version=game.template_version,
            play_url=_play_url(game, settings),
            cover_url=cover_url,
            created_at=game.created_at,
        )


class GamesListResponse(BaseModel):
    items: list[GameResponse]
    total: int
    limit: int
    offset: int


class GameVersionResponse(BaseModel):
    id: str
    version_no: int
    parent_id: str | None
    job_id: str | None
    change_summary: str
    play_url: str
    created_at: datetime

    @classmethod
    def from_entity(cls, version: GameVersion, settings: Settings) -> GameVersionResponse:
        return cls(
            id=version.id,
            version_no=version.version_no,
            parent_id=version.parent_id,
            job_id=version.job_id,
            change_summary=version.change_summary,
            play_url=play_url_for_prefix(version.storage_prefix, settings),
            created_at=version.created_at,
        )


class GameVersionsListResponse(BaseModel):
    items: list[GameVersionResponse]
    current_version_id: str | None


class VersionSourceResponse(BaseModel):
    version_id: str
    source_html: str
    game_js: str = ""
    game_css: str = ""


class RollbackRequest(BaseModel):
    version_id: str = Field(min_length=1)


class RollbackResponse(BaseModel):
    version_id: str
    version_no: int
    play_url: str


class SourceEditRequest(BaseModel):
    game_js: str = Field(min_length=1, description="The edited game.js source")
    game_css: str | None = Field(default=None, description="The edited game.css source")


class SourceEditResponse(BaseModel):
    version_id: str
    play_url: str


class JobDraftFile(BaseModel):
    path: str
    content: str


class JobDraftResponse(BaseModel):
    """Live draft source (Codply JobDraft): the code as it is being written.
    content is the index file once packaged, null before; files lists every
    human-readable bundle file, index.html first."""

    content: str | None = None
    files: list[JobDraftFile] = Field(default_factory=list)


class JobEventItem(BaseModel):
    seq: int
    event: str
    data: dict


class JobEventsResponse(BaseModel):
    """The persisted SSE event log as JSON (seq order) — lets the web tier
    fold steps[]/transcript[] into job snapshots without holding a stream."""

    items: list[JobEventItem]


def bundle_file_url(storage_prefix: str, rel_path: str, settings: Settings) -> str:
    """Absolute URL of one file inside a stored bundle — the same composition
    play URLs use (CDN when configured, the local /g/ play route otherwise)."""
    cdn = settings.storage.cdn_base_url.rstrip("/")
    if cdn:
        return f"{cdn}/{storage_prefix}/{rel_path}"
    base = settings.app.public_base_url.rstrip("/")
    return f"{base}/g/{storage_prefix.removeprefix('games/')}/{rel_path}"


def play_url_for_prefix(storage_prefix: str, settings: Settings) -> str:
    """Compose a bundle URL from its storage prefix. The local play route
    mirrors the storage layout under /g/ (games/{id}[/v{n}] -> /g/{id}[/v{n}]),
    so versioned and legacy prefixes both resolve without special cases."""
    return bundle_file_url(storage_prefix, "index.html", settings)


def _play_url(game: Game | GameSummary, settings: Settings) -> str:
    return play_url_for_prefix(game.storage_prefix, settings)
