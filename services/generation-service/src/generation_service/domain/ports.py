"""Ports (hexagonal boundaries).

Application/use-case code depends only on these Protocols; infrastructure
provides the adapters. Swapping local-folder storage for S3, or SQLite for
Postgres, is a container change — never a domain change.
"""

from __future__ import annotations

from typing import Protocol

from generation_service.domain.entities import (
    ClarifyQuestion,
    Game,
    GameSummary,
    GameVersion,
    GateReport,
    GenerationJob,
    JobStatus,
    LlmUsage,
    PipelineStage,
)
from generation_service.domain.events import JobEvent


class StoragePort(Protocol):
    """Object storage for game bundles. Keys mirror the future bucket layout
    (games/{game_id}/index.html) so local dev and cloud prod are identical."""

    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    async def get(self, key: str) -> bytes: ...

    async def delete(self, key: str) -> None: ...


class GameRepository(Protocol):
    async def add(self, game: Game) -> None: ...

    async def update(self, game: Game) -> None: ...

    async def get(self, game_id: str) -> Game | None: ...

    async def list_games(self, limit: int, offset: int) -> list[GameSummary]: ...

    async def count(self) -> int: ...


class JobRepository(Protocol):
    async def add(self, job: GenerationJob) -> None: ...

    async def get(self, job_id: str) -> GenerationJob | None: ...

    async def set_status(self, job_id: str, status: JobStatus) -> None: ...

    async def set_stage(self, job_id: str, stage: PipelineStage) -> None: ...

    async def mark_running(self, job_id: str) -> bool:
        """CAS QUEUED -> RUNNING; False = the job moved on, do not run."""
        ...

    async def mark_succeeded(
        self, job_id: str, game_id: str, gate_report: GateReport | None
    ) -> bool:
        """CAS RUNNING -> SUCCEEDED; False = a terminal state won, discard."""
        ...

    async def mark_failed(
        self,
        job_id: str,
        error_code: str,
        error_message: str,
        gate_report: GateReport | None = None,
    ) -> None: ...

    async def mark_awaiting_input(
        self, job_id: str, questions: list[ClarifyQuestion], analysis_json: str
    ) -> None: ...

    async def set_answers(self, job_id: str, answers: dict[str, str]) -> bool:
        """CAS: persist answers + QUEUED only if still AWAITING_INPUT; False
        means a concurrent submit/cancel won and no resume must be scheduled."""
        ...

    async def expire_stale_awaiting(
        self, error_code: str, error_message: str, max_age_hours: float
    ) -> int: ...

    async def has_active_job_for_game(self, game_id: str) -> bool: ...

    async def fail_abandoned(self, error_code: str, error_message: str) -> int: ...


class GameVersionRepository(Protocol):
    """Catalog of immutable version bundles. Rows are append-only; 'current'
    lives on the Game (current_version_id/no + storage_prefix)."""

    async def add(self, version: GameVersion) -> None: ...

    async def get(self, game_id: str, version_id: str) -> GameVersion | None: ...

    async def list_for_game(self, game_id: str) -> list[GameVersion]: ...

    async def max_version_no(self, game_id: str) -> int: ...


class LlmCallLog(Protocol):
    """Flat per-call log — the cost-tracking substrate (every LLM call, always)."""

    async def record(self, job_id: str | None, usage: LlmUsage) -> None: ...

    async def usage_for_job(self, job_id: str) -> list[LlmUsage]: ...


class JobEventStore(Protocol):
    """Ordered, replayable log of a job's progress events (for SSE reconnect)."""

    async def append(self, job_id: str, event: JobEvent) -> bool:
        """Persist the event; False when (job_id, seq) already exists (two
        emitters racing — the caller must retry on a later seq)."""
        ...

    async def list_since(self, job_id: str, after_seq: int) -> list[JobEvent]: ...

    async def last_seq(self, job_id: str) -> int: ...
