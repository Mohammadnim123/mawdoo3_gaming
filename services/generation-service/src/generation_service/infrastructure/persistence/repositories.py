"""SQLite implementations of the repository ports."""

from __future__ import annotations

import json
from datetime import datetime

from generation_service.domain.blueprint import GameBlueprint
from generation_service.domain.entities import (
    ClarifyQuestion,
    Game,
    GameSummary,
    GameVersion,
    GateReport,
    GenerationJob,
    JobKind,
    JobStatus,
    LlmUsage,
    PipelineStage,
    utcnow,
)
from generation_service.domain.events import JobEvent
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
                               code_model, storage_prefix, current_version_id,
                               current_version_no, cover_file, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                game.current_version_id,
                game.current_version_no,
                game.cover_file,
                _iso(game.created_at),
            ),
        )

    async def update(self, game: Game) -> None:
        await self._db.execute_write(
            """
            UPDATE games SET title_en = ?, title_ar = ?, genre = ?, summary = ?,
                             default_locale = ?, blueprint_json = ?, template_version = ?,
                             blueprint_model = ?, code_model = ?, storage_prefix = ?,
                             current_version_id = ?, current_version_no = ?, cover_file = ?
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
                game.storage_prefix,
                game.current_version_id,
                game.current_version_no,
                game.cover_file,
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
                   template_version, storage_prefix, cover_file, created_at
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
                cover_file=row["cover_file"],
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
            current_version_id=row["current_version_id"],
            current_version_no=row["current_version_no"],
            cover_file=row["cover_file"],
            created_at=datetime.fromisoformat(row["created_at"]),
        )


class SqliteGameVersionRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def add(self, version: GameVersion) -> None:
        await self._db.execute_write(
            """
            INSERT INTO game_versions (id, game_id, version_no, parent_id, job_id,
                                       change_summary, storage_prefix, blueprint_json,
                                       created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                version.id,
                version.game_id,
                version.version_no,
                version.parent_id,
                version.job_id,
                version.change_summary,
                version.storage_prefix,
                version.blueprint.model_dump_json(),
                _iso(version.created_at),
            ),
        )

    async def get(self, game_id: str, version_id: str) -> GameVersion | None:
        cursor = await self._db.connection.execute(
            "SELECT * FROM game_versions WHERE game_id = ? AND id = ?",
            (game_id, version_id),
        )
        row = await cursor.fetchone()
        return self._to_entity(row) if row else None

    async def list_for_game(self, game_id: str) -> list[GameVersion]:
        cursor = await self._db.connection.execute(
            "SELECT * FROM game_versions WHERE game_id = ? ORDER BY version_no",
            (game_id,),
        )
        rows = await cursor.fetchall()
        return [self._to_entity(row) for row in rows]

    async def max_version_no(self, game_id: str) -> int:
        cursor = await self._db.connection.execute(
            "SELECT COALESCE(MAX(version_no), 0) AS n FROM game_versions WHERE game_id = ?",
            (game_id,),
        )
        row = await cursor.fetchone()
        return int(row["n"]) if row else 0

    @staticmethod
    def _to_entity(row) -> GameVersion:
        return GameVersion(
            id=row["id"],
            game_id=row["game_id"],
            version_no=row["version_no"],
            parent_id=row["parent_id"],
            job_id=row["job_id"],
            change_summary=row["change_summary"],
            storage_prefix=row["storage_prefix"],
            blueprint=GameBlueprint.model_validate_json(row["blueprint_json"]),
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
                                         gate_report_json, questions_json, answers_json,
                                         analysis_json, skip_clarify, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                json.dumps([q.model_dump() for q in job.questions]) if job.questions else None,
                json.dumps(job.answers) if job.answers else None,
                job.analysis_json,
                1 if job.skip_clarify else 0,
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

    async def mark_running(self, job_id: str) -> bool:
        """CAS QUEUED -> RUNNING. False means the job moved on (a cancel
        landed while it sat in the queue) — the run must not start."""
        rows = await self._db.execute_write(
            "UPDATE generation_jobs SET status = ?, updated_at = ? "
            "WHERE id = ? AND status = ?",
            (JobStatus.RUNNING.value, _iso(utcnow()), job_id, JobStatus.QUEUED.value),
        )
        return rows > 0

    async def mark_succeeded(
        self, job_id: str, game_id: str, gate_report: GateReport | None
    ) -> bool:
        """CAS RUNNING -> SUCCEEDED. False means something terminal (a
        creator cancel) already claimed the row — the outcome must be
        discarded, never published over it."""
        rows = await self._db.execute_write(
            "UPDATE generation_jobs SET status = ?, stage = ?, game_id = ?, "
            "gate_report_json = ?, updated_at = ? WHERE id = ? AND status = ?",
            (
                JobStatus.SUCCEEDED.value,
                PipelineStage.DONE.value,
                game_id,
                gate_report.model_dump_json() if gate_report else None,
                _iso(utcnow()),
                job_id,
                JobStatus.RUNNING.value,
            ),
        )
        return rows > 0

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

    async def mark_awaiting_input(
        self, job_id: str, questions: list[ClarifyQuestion], analysis_json: str
    ) -> bool:
        """CAS RUNNING -> AWAITING_INPUT. False means the job went terminal
        (a creator cancel) while intake ran — the pause must be abandoned,
        never resurrect a cancelled job as answerable."""
        rows = await self._db.execute_write(
            "UPDATE generation_jobs SET status = ?, stage = ?, questions_json = ?, "
            "analysis_json = ?, updated_at = ? WHERE id = ? AND status = ?",
            (
                JobStatus.AWAITING_INPUT.value,
                PipelineStage.CLARIFYING.value,
                json.dumps([q.model_dump() for q in questions]),
                analysis_json,
                _iso(utcnow()),
                job_id,
                JobStatus.RUNNING.value,
            ),
        )
        return rows > 0

    async def set_answers(self, job_id: str, answers: dict[str, str]) -> bool:
        """Compare-and-set: answers only land on a job still awaiting them.
        Returns False when something else (a second submit, a cancel) already
        moved the job on — the caller must NOT schedule a resume then."""
        rows = await self._db.execute_write(
            "UPDATE generation_jobs SET answers_json = ?, status = ?, updated_at = ? "
            "WHERE id = ? AND status = ?",
            (
                json.dumps(answers),
                JobStatus.QUEUED.value,
                _iso(utcnow()),
                job_id,
                JobStatus.AWAITING_INPUT.value,
            ),
        )
        return rows > 0

    async def has_active_job_for_game(self, game_id: str) -> bool:
        placeholders = ", ".join("?" for _ in JobStatus.active())
        cursor = await self._db.connection.execute(
            f"SELECT 1 FROM generation_jobs WHERE game_id = ? AND status IN ({placeholders}) "
            "LIMIT 1",
            (game_id, *[s.value for s in JobStatus.active()]),
        )
        return await cursor.fetchone() is not None

    async def expire_stale_awaiting(
        self, error_code: str, error_message: str, max_age_hours: float
    ) -> int:
        """Fail AWAITING_INPUT jobs whose questions went unanswered for too
        long — without this they would accumulate forever (paused jobs are
        deliberately exempt from the restart sweep)."""
        from datetime import timedelta

        cutoff = _iso(utcnow() - timedelta(hours=max_age_hours))
        return await self._db.execute_write(
            "UPDATE generation_jobs SET status = ?, error_code = ?, error_message = ?, "
            "updated_at = ? WHERE status = ? AND updated_at < ?",
            (
                JobStatus.FAILED.value,
                error_code,
                error_message,
                _iso(utcnow()),
                JobStatus.AWAITING_INPUT.value,
                cutoff,
            ),
        )

    async def fail_abandoned(self, error_code: str, error_message: str) -> int:
        """Fail every job whose asyncio task died with the previous process —
        queued/running only. A job paused on clarifying questions holds no
        task; it stays AWAITING_INPUT and resumes from persisted state."""
        statuses = JobStatus.abandoned_on_restart()
        placeholders = ", ".join("?" for _ in statuses)
        return await self._db.execute_write(
            f"UPDATE generation_jobs SET status = ?, error_code = ?, error_message = ?, "
            f"updated_at = ? WHERE status IN ({placeholders})",
            (
                JobStatus.FAILED.value,
                error_code,
                error_message,
                _iso(utcnow()),
                *[s.value for s in statuses],
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
            questions=(
                [ClarifyQuestion.model_validate(q) for q in json.loads(row["questions_json"])]
                if row["questions_json"]
                else []
            ),
            answers=json.loads(row["answers_json"]) if row["answers_json"] else {},
            analysis_json=row["analysis_json"],
            skip_clarify=bool(row["skip_clarify"]),
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

    async def append(self, job_id: str, event: JobEvent) -> bool:
        rows = await self._db.execute_write(
            "INSERT OR IGNORE INTO job_events (job_id, seq, event, data_json, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (job_id, event.seq, event.event, json.dumps(event.data), _iso(utcnow())),
        )
        return rows > 0

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

    async def last_seq(self, job_id: str) -> int:
        """Highest persisted seq for a job — the resume point for an emitter
        picking up after a pause (seqs must stay monotonic across the gap)."""
        cursor = await self._db.connection.execute(
            "SELECT COALESCE(MAX(seq), 0) AS n FROM job_events WHERE job_id = ?",
            (job_id,),
        )
        row = await cursor.fetchone()
        return int(row["n"]) if row else 0


class SqliteJobDraftStore:
    """Live draft snapshot per job (Codply JobDraft shape) — upserted as the
    pipeline writes code, read by GET /generations/{id}/draft."""

    def __init__(self, db: Database) -> None:
        self._db = db

    async def save(self, job_id: str, draft: dict) -> None:
        await self._db.execute_write(
            "INSERT INTO job_drafts (job_id, draft_json, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(job_id) DO UPDATE SET draft_json = excluded.draft_json, "
            "updated_at = excluded.updated_at",
            (job_id, json.dumps(draft, ensure_ascii=False), _iso(utcnow())),
        )

    async def get(self, job_id: str) -> dict | None:
        cursor = await self._db.connection.execute(
            "SELECT draft_json FROM job_drafts WHERE job_id = ?", (job_id,)
        )
        row = await cursor.fetchone()
        return json.loads(row["draft_json"]) if row else None
