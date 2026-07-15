"""Core domain entities and value objects."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from uuid import uuid4

from pydantic import BaseModel

from generation_service.domain.blueprint import GameBlueprint


def new_id() -> str:
    return uuid4().hex[:12]


def utcnow() -> datetime:
    return datetime.now(tz=UTC)


def game_storage_prefix(game_id: str) -> str:
    """Canonical storage key prefix for one game's bundle. Every producer and
    consumer of bundle keys goes through here so the layout can never drift."""
    return f"games/{game_id}"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"

    @classmethod
    def active(cls) -> tuple[JobStatus, ...]:
        return (cls.QUEUED, cls.RUNNING)


class JobKind(StrEnum):
    CREATE = "create"
    TWEAK = "tweak"


class FailureCode(StrEnum):
    """Every way a generation job can fail, as reported in the API error envelope."""

    OUT_OF_SCOPE = "out_of_scope"
    GATE_FAILED = "gate_failed"
    PIPELINE_ERROR = "pipeline_error"
    PIPELINE_TIMEOUT = "pipeline_timeout"
    GAME_NOT_FOUND = "game_not_found"
    INTERRUPTED = "interrupted"


class PipelineStage(StrEnum):
    QUEUED = "queued"
    UNDERSTANDING = "understanding"
    BLUEPRINT = "blueprint"
    CODE_GENERATION = "code_generation"
    VALIDATION = "validation"
    PACKAGING = "packaging"
    STORAGE = "storage"
    DONE = "done"


class GateCheck(BaseModel):
    check_id: str
    passed: bool
    detail: str = ""


# Checks whose failure means the game is unsafe or cannot run at all — these
# can never ship, even best-effort. Everything else (lifecycle hygiene, i18n,
# size, ready(), deep logic review) is advisory: it drives retries, but an
# attempt failing only advisory checks is still published rather than showing
# the creator a generation error. New check ids are advisory unless listed.
BLOCKING_CHECK_IDS: frozenset[str] = frozenset(
    {
        "sandbox.forbidden_api",  # untrusted code escaping the sandbox
        "syntax.node_check",  # does not parse — a blank iframe, not a game
        "contract.create_game",  # no entrypoint — the runtime cannot boot it
        "runtime.smoke_boot",  # crashes or freezes on boot for every player
    }
)


class GateReport(BaseModel):
    """Outcome of the quality gate. Failures drive code-generation retries;
    once retries are exhausted, only blocking failures keep a game from being
    published (see BLOCKING_CHECK_IDS)."""

    passed: bool
    checks: list[GateCheck]

    @property
    def failures(self) -> list[GateCheck]:
        return [c for c in self.checks if not c.passed]

    @property
    def blocking_failures(self) -> list[GateCheck]:
        return [c for c in self.failures if c.check_id in BLOCKING_CHECK_IDS]

    @property
    def shippable(self) -> bool:
        """True when the game is safe and runnable — publishable best-effort
        even if advisory checks failed."""
        return not self.blocking_failures

    def feedback(self) -> str:
        """Actionable failure summary fed back into code-generation retries."""
        return "\n".join(f"- [{c.check_id}] {c.detail}" for c in self.failures)


class GeneratedGameCode(BaseModel):
    """AI#2 output: the bespoke gameplay files (contract: createGame-v1)."""

    game_js: str
    game_css: str = ""


class PipelineFailure(BaseModel):
    stage: PipelineStage
    code: FailureCode
    message: str


class LlmUsage(BaseModel):
    stage: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


@dataclass(slots=True)
class Game:
    """A generated, gate-approved, stored game. The reproducibility record:
    prompt + blueprint + template/model versions fully describe the build."""

    id: str
    title_en: str
    title_ar: str
    genre: str
    summary: str
    default_locale: str
    prompt: str
    blueprint: GameBlueprint
    template_version: str
    blueprint_model: str
    code_model: str
    storage_prefix: str
    created_at: datetime = field(default_factory=utcnow)

    def apply_blueprint(self, blueprint: GameBlueprint) -> None:
        """Bring the metadata in line with a (revised) blueprint — the single
        place blueprint-derived fields are projected onto the entity."""
        self.title_en = blueprint.title.en
        self.title_ar = blueprint.title.ar
        self.genre = blueprint.genre.value
        self.summary = blueprint.summary
        self.default_locale = blueprint.default_locale
        self.blueprint = blueprint


@dataclass(slots=True)
class GameSummary:
    """Listing projection of a Game — everything the list API needs, without
    the cost of parsing the full blueprint JSON per row."""

    id: str
    title_en: str
    title_ar: str
    genre: str
    summary: str
    default_locale: str
    prompt: str
    template_version: str
    storage_prefix: str
    created_at: datetime


@dataclass(slots=True)
class GenerationJob:
    """One generation request moving through the pipeline.

    kind=CREATE builds a new game from a prompt; kind=TWEAK rebuilds an
    existing game (game_id set upfront) from its blueprint + an instruction.
    """

    id: str
    prompt: str
    requested_locale: str | None
    kind: JobKind = JobKind.CREATE
    status: JobStatus = JobStatus.QUEUED
    stage: PipelineStage = PipelineStage.QUEUED
    game_id: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    gate_report: GateReport | None = None
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)

    @classmethod
    def create(
        cls,
        prompt: str,
        requested_locale: str | None,
        kind: JobKind = JobKind.CREATE,
        game_id: str | None = None,
    ) -> GenerationJob:
        return cls(
            id=new_id(),
            prompt=prompt,
            requested_locale=requested_locale,
            kind=kind,
            game_id=game_id,
        )
