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
    consumer of bundle keys goes through here so the layout can never drift.

    Pre-versioning games live directly under this prefix; versioned bundles
    live under game_version_prefix(). Both resolve through Game.storage_prefix,
    so readers never care which era a game was built in."""
    return f"games/{game_id}"


def game_version_prefix(game_id: str, version_no: int) -> str:
    """Storage key prefix for one immutable version of a game's bundle.
    Versions are never overwritten — each build lands in its own v{n}/ dir,
    which is what makes the version tree and rollback possible."""
    return f"{game_storage_prefix(game_id)}/v{version_no}"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    AWAITING_INPUT = "awaiting_input"
    SUCCEEDED = "succeeded"
    FAILED = "failed"

    @classmethod
    def active(cls) -> tuple[JobStatus, ...]:
        """Statuses that occupy a game's one-job-at-a-time slot. AWAITING_INPUT
        counts: the creator is mid-conversation with this job."""
        return (cls.QUEUED, cls.RUNNING, cls.AWAITING_INPUT)

    @classmethod
    def abandoned_on_restart(cls) -> tuple[JobStatus, ...]:
        """Statuses that cannot survive a process restart (their asyncio task
        died with the process). AWAITING_INPUT is deliberately absent — a
        paused job holds no task and resumes from persisted state."""
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
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class PipelineStage(StrEnum):
    QUEUED = "queued"
    UNDERSTANDING = "understanding"
    CLARIFYING = "clarifying"
    BLUEPRINT = "blueprint"
    CODE_GENERATION = "code_generation"
    VALIDATION = "validation"
    PACKAGING = "packaging"
    STORAGE = "storage"
    DONE = "done"


class ClarifyOption(BaseModel):
    """One tappable answer for a clarifying question."""

    id: str
    label: str


class ClarifyQuestion(BaseModel):
    """A clarifying question the pipeline may ask before designing (2–3 max,
    each with a smart default so 'Surprise me' can skip the whole step)."""

    id: str
    question: str
    options: list[ClarifyOption]
    default_option_id: str


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
    prompt + blueprint + template/model versions fully describe the build.

    storage_prefix always points at the *current* version's bundle; the
    current_version_* pointers say which GameVersion row that is."""

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
    current_version_id: str | None = None
    current_version_no: int = 1
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
class GameVersion:
    """One immutable published build of a game. Bundles are write-once — the
    version tree and rollback both depend on old builds staying playable."""

    id: str
    game_id: str
    version_no: int
    parent_id: str | None
    job_id: str | None
    change_summary: str
    storage_prefix: str
    blueprint: GameBlueprint
    created_at: datetime = field(default_factory=utcnow)


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

    While paused on clarifying questions (status=AWAITING_INPUT) the job holds
    everything a resume needs: the questions asked, the creator's answers, and
    the understand-stage analysis (opaque JSON — the pipeline owns its shape),
    so a resumed run never repeats the intake LLM call.
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
    questions: list[ClarifyQuestion] = field(default_factory=list)
    answers: dict[str, str] = field(default_factory=dict)
    analysis_json: str | None = None
    skip_clarify: bool = False
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)

    @classmethod
    def create(
        cls,
        prompt: str,
        requested_locale: str | None,
        kind: JobKind = JobKind.CREATE,
        game_id: str | None = None,
        skip_clarify: bool = False,
    ) -> GenerationJob:
        return cls(
            id=new_id(),
            prompt=prompt,
            requested_locale=requested_locale,
            kind=kind,
            game_id=game_id,
            skip_clarify=skip_clarify,
        )
