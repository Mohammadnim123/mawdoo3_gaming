"""SQLite implementations of the repository ports."""

from __future__ import annotations

import json
from datetime import datetime

from generation_service.domain.blueprint import GameBlueprint
from generation_service.domain.events import JobEvent
from generation_service.domain.entities import (
    Game,
    GameSummary,
    GateReport,
    GenerationJob,
    JobKind,
    JobStatus,
    LlmUsage,
    PipelineStage,
    utcnow,
)
from generation_service.infrastructure.persistence.database import Database


def _iso(dt: datetime) -> str:
    return dt.isoformat()


class SqliteGameRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def add(self, game: Game) -> None:
        await self._db.execute_write(
            """
            INSERT INTO games (id, title_en, title_ar, genre, summary, default_locale,
                               prompt, blueprint_json, template_version, blueprint_model,
                               code_model, storage_prefix, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                game.id,
                game.title_en,
                game.title_ar,
                game.genre,
                game.summary,
                game.default_locale,
                game.prompt,
                game.blueprint.model_dump_json(),
                game.template_version,
                game.blueprint_model,
                game.code_model,
                game.storage_prefix,
                _iso(game.created_at),
            ),
        )

    async def update(self, game: Game) -> None:
        await self._db.execute_write(
            """
            UPDATE games SET title_en = ?, title_ar = ?, genre = ?, summary = ?,
                             default_locale = ?, blueprint_json = ?, template_version = ?,
                             blueprint_model = ?, code_model = ?
            WHERE id = ?
            """,
            (
                game.title_en,
                game.title_ar,
                game.genre,
                game.summary,
                game.default_locale,
                game.blueprint.model_dump_json(),
                game.template_version,
                game.blueprint_model,
                game.code_model,
                game.id,
            ),
        )

    async def get(self, game_id: str) -> Game | None:
        cursor = await self._db.connection.execute(
            "SELECT * FROM games WHERE id = ?", (game_id,)
        )
        row = await cursor.fetchone()
        return self._to_entity(row) if row else None

    async def list_games(self, limit: int, offset: int) -> list[GameSummary]:
        # Listing projection: the multi-KB blueprint_json is deliberately not
        # selected (or parsed) here — only get() pays that cost. The id
        # tiebreaker keeps pagination stable across equal timestamps.
        cursor = await self._db.connection.execute(
            """
            SELECT id, title_en, title_ar, genre, summary, default_locale, prompt,
                   template_version, storage_prefix, created_at
            FROM games ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
            """,
            (limit, offset),
        )
        rows = await cursor.fetchall()
        return [
            GameSummary(
                id=row["id"],
                title_en=row["title_en"],
                title_ar=row["title_ar"],
                genre=row["genre"],
                summary=row["summary"],
                default_locale=row["default_locale"],
                prompt=row["prompt"],
                template_version=row["template_version"],
                storage_prefix=row["storage_prefix"],
                created_at=datetime.fromisoformat(row["created_at"]),
            )
            for row in rows
        ]

    async def count(self) -> int:
        cursor = await self._db.connection.execute("SELECT COUNT(*) AS n FROM games")
        row = await cursor.fetchone()
        return int(row["n"]) if row else 0

    @staticmethod
    def _to_entity(row) -> Game:
        return Game(
            id=row["id"],
            title_en=row["title_en"],
            title_ar=row["title_ar"],
            genre=row["genre"],
            summary=row["summary"],
            default_locale=row["default_locale"],
            prompt=row["prompt"],
            blueprint=GameBlueprint.model_validate_json(row["blueprint_json"]),
            template_version=row["template_version"],
            blueprint_model=row["blueprint_model"],
            code_model=row["code_model"],
            storage_prefix=row["storage_prefix"],
            created_at=datetime.fromisoformat(row["created_at"]),
        )


class SqliteJobRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def add(self, job: GenerationJob) -> None:
        await self._db.execute_write(
            """
            INSERT INTO generation_jobs (id, status, stage, kind, prompt, requested_locale,
                                         game_id, error_code, error_message,
                                         gate_report_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job.id,
                job.status.value,
                job.stage.value,
                job.kind.value,
                job.prompt,
                job.requested_locale,
                job.game_id,
                job.error_code,
                job.error_message,
                job.gate_report.model_dump_json() if job.gate_report else None,
                _iso(job.created_at),
                _iso(job.updated_at),
            ),
        )

    async def get(self, job_id: str) -> GenerationJob | None:
        cursor = await self._db.connection.execute(
            "SELECT * FROM generation_jobs WHERE id = ?", (job_id,)
        )
        row = await cursor.fetchone()
        return self._to_entity(row) if row else None

    async def set_status(self, job_id: str, status: JobStatus) -> None:
        await self._touch(job_id, "status = ?", (status.value,))

    async def set_stage(self, job_id: str, stage: PipelineStage) -> None:
        await self._touch(job_id, "stage = ?", (stage.value,))

    async def mark_succeeded(
        self, job_id: str, game_id: str, gate_report: GateReport | None
    ) -> None:
        await self._touch(
            job_id,
            "status = ?, stage = ?, game_id = ?, gate_report_json = ?",
            (
                JobStatus.SUCCEEDED.value,
                PipelineStage.DONE.value,
                game_id,
                gate_report.model_dump_json() if gate_report else None,
            ),
        )

    async def mark_failed(
        self,
        job_id: str,
        error_code: str,
        error_message: str,
        gate_report: GateReport | None = None,
    ) -> None:
        await self._touch(
            job_id,
            "status = ?, error_code = ?, error_message = ?, gate_report_json = ?",
            (
                JobStatus.FAILED.value,
                error_code,
                error_message,
                gate_report.model_dump_json() if gate_report else None,
            ),
        )

    async def has_active_job_for_game(self, game_id: str) -> bool:
        placeholders = ", ".join("?" for _ in JobStatus.active())
        cursor = await self._db.connection.execute(
            f"SELECT 1 FROM generation_jobs WHERE game_id = ? AND status IN ({placeholders}) "
            "LIMIT 1",
            (game_id, *[s.value for s in JobStatus.active()]),
        )
        return await cursor.fetchone() is not None

    async def fail_abandoned(self, error_code: str, error_message: str) -> int:
        """Fail every job still queued/running — called once at startup, when
        any such row is by definition a job the previous process lost."""
        placeholders = ", ".join("?" for _ in JobStatus.active())
        return await self._db.execute_write(
            f"UPDATE generation_jobs SET status = ?, error_code = ?, error_message = ?, "
            f"updated_at = ? WHERE status IN ({placeholders})",
            (
                JobStatus.FAILED.value,
                error_code,
                error_message,
                _iso(utcnow()),
                *[s.value for s in JobStatus.active()],
            ),
        )

    async def _touch(self, job_id: str, set_clause: str, params: tuple) -> None:
        await self._db.execute_write(
            f"UPDATE generation_jobs SET {set_clause}, updated_at = ? WHERE id = ?",
            (*params, _iso(utcnow()), job_id),
        )

    @staticmethod
    def _to_entity(row) -> GenerationJob:
        return GenerationJob(
            id=row["id"],
            prompt=row["prompt"],
            requested_locale=row["requested_locale"],
            kind=JobKind(row["kind"]),
            status=JobStatus(row["status"]),
            stage=PipelineStage(row["stage"]),
            game_id=row["game_id"],
            error_code=row["error_code"],
            error_message=row["error_message"],
            gate_report=(
                GateReport.model_validate_json(row["gate_report_json"])
                if row["gate_report_json"]
                else None
            ),
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )


class SqliteLlmCallLog:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def record(self, job_id: str | None, usage: LlmUsage) -> None:
        await self._db.execute_write(
            """
            INSERT INTO llm_calls (job_id, stage, model, input_tokens, output_tokens,
                                   total_tokens, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                usage.stage,
                usage.model,
                usage.input_tokens,
                usage.output_tokens,
                usage.total_tokens,
                _iso(utcnow()),
            ),
        )

    async def usage_for_job(self, job_id: str) -> list[LlmUsage]:
        cursor = await self._db.connection.execute(
            "SELECT stage, model, input_tokens, output_tokens, total_tokens "
            "FROM llm_calls WHERE job_id = ? ORDER BY id",
            (job_id,),
        )
        rows = await cursor.fetchall()
        return [
            LlmUsage(
                stage=row["stage"],
                model=row["model"],
                input_tokens=row["input_tokens"],
                output_tokens=row["output_tokens"],
                total_tokens=row["total_tokens"],
            )
            for row in rows
        ]


class SqliteJobEventStore:
    """Persisted, replayable job-event log backing SSE reconnection."""

    def __init__(self, db: Database) -> None:
        self._db = db

    async def append(self, job_id: str, event: JobEvent) -> None:
        await self._db.execute_write(
            "INSERT OR IGNORE INTO job_events (job_id, seq, event, data_json, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (job_id, event.seq, event.event, json.dumps(event.data), _iso(utcnow())),
        )

    async def list_since(self, job_id: str, after_seq: int) -> list[JobEvent]:
        cursor = await self._db.connection.execute(
            "SELECT seq, event, data_json FROM job_events WHERE job_id = ? AND seq > ? "
            "ORDER BY seq",
            (job_id, after_seq),
        )
        rows = await cursor.fetchall()
        return [
            JobEvent(seq=row["seq"], event=row["event"], data=json.loads(row["data_json"]))
            for row in rows
        ]
