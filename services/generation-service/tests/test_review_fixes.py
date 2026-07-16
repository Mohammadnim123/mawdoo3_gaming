"""Regression tests for the review-loop fixes: cancel-vs-success races,
answers CAS, seq-collision retry, eventless-failure stream termination, and
awaiting-input expiry."""

from __future__ import annotations

import asyncio

from tests.conftest import boot_client, drain_job

from generation_service.domain.entities import (
    ClarifyOption,
    ClarifyQuestion,
    GenerationJob,
    JobStatus,
)
from generation_service.domain.events import JobEvent

QUESTION = ClarifyQuestion(
    id="q_1",
    question="What theme?",
    options=[ClarifyOption(id="opt_1", label="Space"), ClarifyOption(id="opt_2", label="Jungle")],
    default_option_id="opt_1",
)


def test_stream_synthesizes_terminal_for_eventless_failure(tmp_path, monkeypatch):
    """A job can be FAILED with no terminal event in its log (restart sweep,
    or the failure emit itself failed) — the stream must still close with a
    synthesized 'failed' frame instead of heartbeating forever."""
    from generation_service.application.events import JobEventEmitter
    from generation_service.infrastructure.ai.pipeline import GenerationPipeline

    async def crashing_astream(self, state):
        yield ("understand", {})
        raise RuntimeError("boom")

    monkeypatch.setattr(GenerationPipeline, "astream", crashing_astream)

    original_emit = JobEventEmitter.emit

    async def flaky_emit(self, event, data=None):
        if event == "failed":
            raise RuntimeError("event store down")
        await original_emit(self, event, data)

    monkeypatch.setattr(JobEventEmitter, "emit", flaky_emit)

    with boot_client(tmp_path, monkeypatch, CDN_BASE_URL="") as client:
        job_id = client.post(
            "/api/v1/generations", json={"prompt": "make me a jungle game"}
        ).json()["id"]
        snap = drain_job(client, job_id)
        assert snap["status"] == "failed"

        stream = client.get(f"/api/v1/generations/{job_id}/stream")
        assert stream.status_code == 200
        assert "event: failed" in stream.text  # synthesized — the log has none


def test_execute_never_runs_a_terminal_job(tmp_path):
    """A cancel landing before the task starts must win: execute() sees the
    terminal row and returns without flipping it back to RUNNING."""

    async def scenario() -> str:
        from generation_service.application.events import JobEventBus
        from generation_service.application.use_cases.run_generation import (
            RunGenerationUseCase,
        )
        from generation_service.infrastructure.persistence import (
            Database,
            SqliteGameRepository,
            SqliteGameVersionRepository,
            SqliteJobEventStore,
            SqliteJobRepository,
        )

        db = Database(tmp_path / "terminal.db")
        await db.connect()
        jobs = SqliteJobRepository(db)
        job = GenerationJob.create(prompt="a jungle game", requested_locale=None)
        await jobs.add(job)
        await jobs.mark_failed(job.id, "cancelled", "cancelled by the creator")

        class ExplodingPipeline:
            async def astream(self, state):  # pragma: no cover — must not run
                raise AssertionError("pipeline ran for a terminal job")
                yield  # noqa: unreachable — makes this an async generator

        use_case = RunGenerationUseCase(
            pipeline=ExplodingPipeline(),
            jobs=jobs,
            games=SqliteGameRepository(db),
            versions=SqliteGameVersionRepository(db),
            template_version="t",
            blueprint_model="m",
            code_model="m",
            timeout_seconds=5,
            event_store=SqliteJobEventStore(db),
            event_bus=JobEventBus(),
        )
        await use_case.execute(job)
        refreshed = await jobs.get(job.id)
        await db.close()
        assert refreshed is not None
        return refreshed.status.value

    assert asyncio.run(scenario()) == "failed"


def test_set_answers_cas_single_winner(tmp_path):
    """Only the first answers submission moves the job on; the loser gets
    False and must not schedule a second pipeline."""

    async def scenario() -> tuple[bool, bool, str]:
        from generation_service.infrastructure.persistence import (
            Database,
            SqliteJobRepository,
        )

        db = Database(tmp_path / "cas.db")
        await db.connect()
        jobs = SqliteJobRepository(db)
        job = GenerationJob.create(prompt="a jungle game", requested_locale=None)
        await jobs.add(job)
        assert await jobs.mark_running(job.id)
        assert await jobs.mark_awaiting_input(job.id, [QUESTION], "{}")

        first = await jobs.set_answers(job.id, {"q_1": "opt_2"})
        second = await jobs.set_answers(job.id, {"q_1": "opt_1"})
        refreshed = await jobs.get(job.id)
        await db.close()
        assert refreshed is not None
        return first, second, refreshed.answers.get("q_1", "")

    first, second, answer = asyncio.run(scenario())
    assert first is True
    assert second is False
    assert answer == "opt_2"  # the loser's answers never landed


def test_emitter_seq_collision_skips_forward(tmp_path):
    """Two emitters racing on one job must both persist their events —
    nothing silently dropped from the replay log."""

    async def scenario() -> list[tuple[int, str]]:
        from generation_service.application.events import JobEventBus, JobEventEmitter
        from generation_service.infrastructure.persistence import (
            Database,
            SqliteJobEventStore,
        )

        db = Database(tmp_path / "seq.db")
        await db.connect()
        store = SqliteJobEventStore(db)
        bus = JobEventBus()
        # Both emitters start from the same seq — the cancel-vs-run race.
        run_emitter = JobEventEmitter("job1", store, bus, start_seq=3)
        cancel_emitter = JobEventEmitter("job1", store, bus, start_seq=3)
        await store.append("job1", JobEvent(seq=3, event="step", data={}))

        await run_emitter.emit("heal", {"attempt": 1})
        await cancel_emitter.emit("failed", {"error_code": "cancelled"})
        events = await store.list_since("job1", 0)
        await db.close()
        return [(e.seq, e.event) for e in events]

    events = asyncio.run(scenario())
    assert [name for _, name in events] == ["step", "heal", "failed"]
    seqs = [seq for seq, _ in events]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)


def test_pause_cas_loses_to_cancel(tmp_path):
    """A cancel landing while intake runs must win: the pause CAS fails and
    the cancelled job never resurfaces as answerable."""

    async def scenario() -> tuple[bool, str]:
        from generation_service.infrastructure.persistence import (
            Database,
            SqliteJobRepository,
        )

        db = Database(tmp_path / "pausecas.db")
        await db.connect()
        jobs = SqliteJobRepository(db)
        job = GenerationJob.create(prompt="a jungle game", requested_locale=None)
        await jobs.add(job)
        assert await jobs.mark_running(job.id)
        await jobs.mark_failed(job.id, "cancelled", "cancelled by the creator")

        paused = await jobs.mark_awaiting_input(job.id, [QUESTION], "{}")
        refreshed = await jobs.get(job.id)
        await db.close()
        assert refreshed is not None
        return paused, refreshed.status.value

    paused, status = asyncio.run(scenario())
    assert paused is False
    assert status == "failed"


def test_expire_stale_awaiting(tmp_path):
    """Old AWAITING_INPUT jobs are reaped; fresh ones are untouched."""

    async def scenario() -> tuple[str, str]:
        from generation_service.infrastructure.persistence import (
            Database,
            SqliteJobRepository,
        )

        db = Database(tmp_path / "ttl.db")
        await db.connect()
        jobs = SqliteJobRepository(db)
        stale = GenerationJob.create(prompt="an old paused game", requested_locale=None)
        fresh = GenerationJob.create(prompt="a new paused game", requested_locale=None)
        await jobs.add(stale)
        await jobs.add(fresh)
        for j in (stale, fresh):
            assert await jobs.mark_running(j.id)
            assert await jobs.mark_awaiting_input(j.id, [QUESTION], "{}")
        await db.execute_write(
            "UPDATE generation_jobs SET updated_at = '2020-01-01T00:00:00+00:00' "
            "WHERE id = ?",
            (stale.id,),
        )

        expired = await jobs.expire_stale_awaiting("expired", "unanswered", 48.0)
        stale_after = await jobs.get(stale.id)
        fresh_after = await jobs.get(fresh.id)
        await db.close()
        assert expired == 1
        assert stale_after is not None and fresh_after is not None
        return stale_after.status.value, fresh_after.status.value

    stale_status, fresh_status = asyncio.run(scenario())
    assert stale_status == "failed"
    assert fresh_status == "awaiting_input"
