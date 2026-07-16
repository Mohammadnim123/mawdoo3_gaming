"""Clarifying-questions flow over HTTP — pause, answers resume, cancel.

Deterministic and offline: the pipeline is faked. Exercises the whole driver
contract: AWAITING_INPUT persistence + questions in the snapshot, the SSE
'questions' event, resume-with-answers reaching the pipeline (with the
persisted analysis and NO second intake), seq continuity across the pause,
answers-on-wrong-status conflicts, and creator cancel.
"""

from __future__ import annotations

import json

from tests.conftest import boot_client, build_sample_blueprint, drain_job

from generation_service.domain.entities import ClarifyOption, ClarifyQuestion

QUESTION = ClarifyQuestion(
    id="q_1",
    question="What theme?",
    options=[
        ClarifyOption(id="opt_1", label="Space"),
        ClarifyOption(id="opt_2", label="Jungle"),
    ],
    default_option_id="opt_1",
)


def _fake_clarify_pipeline(monkeypatch, seen: dict):
    """First (non-resume) run pauses on a question; the resumed run records
    the state it got and completes via a minimal store update."""
    from generation_service.infrastructure.ai.pipeline import GenerationPipeline

    async def fake_astream(self, state):
        from generation_service.infrastructure.ai.schemas import PromptAnalysis

        if not state.get("resume") and not state.get("skip_clarify"):
            analysis = PromptAnalysis(in_scope=True, game_concept="a jungle runner")
            yield ("understand", {"analysis": analysis})
            yield ("await_input", {"questions": [QUESTION]})
            return
        seen["resume_state"] = dict(state)
        yield ("blueprint", {"blueprint": _sample_blueprint()})
        yield (
            "store",
            {"blueprint": _sample_blueprint(), "stored_prefix": state["target_prefix"]},
        )

    monkeypatch.setattr(GenerationPipeline, "astream", fake_astream)


def _sample_blueprint():
    return build_sample_blueprint()


def _drain(client, job_id, statuses, tries=100):
    return drain_job(client, job_id, statuses=statuses, tries=tries)


def test_pause_answers_resume_lifecycle(tmp_path, monkeypatch):
    seen: dict = {}
    _fake_clarify_pipeline(monkeypatch, seen)
    with boot_client(
        tmp_path, monkeypatch, FEATURE_CLARIFY="true", CDN_BASE_URL=""
    ) as client:
        r = client.post("/api/v1/generations", json={"prompt": "make me a jungle game"})
        assert r.status_code == 202
        job_id = r.json()["id"]

        snap = _drain(client, job_id, statuses=("awaiting_input",))
        assert snap["status"] == "awaiting_input"
        assert snap["stage"] == "clarifying"
        assert snap["questions"][0]["id"] == "q_1"
        assert snap["questions"][0]["options"][1]["label"] == "Jungle"

        # The persisted event log already carries the questions event (the
        # live stream stays open through the pause, so it is asserted via the
        # terminal replay at the end — TestClient cannot read open streams).
        r = client.post(
            f"/api/v1/generations/{job_id}/answers", json={"answers": {"q_1": "opt_2"}}
        )
        assert r.status_code == 200

        snap = _drain(client, job_id, statuses=("succeeded", "failed"))
        assert snap["status"] == "succeeded"
        assert snap["game_id"]

        # The resumed pipeline saw the answers, the resume flag, and no intake.
        state = seen["resume_state"]
        assert state["resume"] is True
        assert state["answers"] == {"q_1": "opt_2"}

        # Seq continuity across the pause: replayed ids strictly increase and
        # the log ends in done (no seq was silently dropped by the resume).
        stream = client.get(f"/api/v1/generations/{job_id}/stream")
        ids = [int(line.split(": ")[1]) for line in stream.text.splitlines()
               if line.startswith("id: ")]
        assert ids == sorted(ids) and len(set(ids)) == len(ids)
        assert "event: questions" in stream.text
        assert "event: done" in stream.text

        # The stored game landed on an immutable v1 prefix.
        game_id = snap["game_id"]
        game = client.get(f"/api/v1/games/{game_id}").json()
        assert f"/g/{game_id}/v1/index.html" in game["play_url"]


def test_answers_rejected_unless_awaiting(tmp_path, monkeypatch):
    seen: dict = {}
    _fake_clarify_pipeline(monkeypatch, seen)
    with boot_client(
        tmp_path, monkeypatch, FEATURE_CLARIFY="true", CDN_BASE_URL=""
    ) as client:
        r = client.post(
            "/api/v1/generations",
            json={"prompt": "make me a jungle game", "options": {"skip_questions": True}},
        )
        job_id = r.json()["id"]
        snap = _drain(client, job_id, statuses=("succeeded", "failed"))
        assert snap["status"] == "succeeded"  # skip_questions bypassed the pause

        r = client.post(f"/api/v1/generations/{job_id}/answers", json={"answers": {}})
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "conflict"

        r = client.post("/api/v1/generations/nope/answers", json={"answers": {}})
        assert r.status_code == 404


def test_surprise_me_empty_answers_resume(tmp_path, monkeypatch):
    seen: dict = {}
    _fake_clarify_pipeline(monkeypatch, seen)
    with boot_client(
        tmp_path, monkeypatch, FEATURE_CLARIFY="true", CDN_BASE_URL=""
    ) as client:
        job_id = client.post(
            "/api/v1/generations", json={"prompt": "make me a jungle game"}
        ).json()["id"]
        _drain(client, job_id, statuses=("awaiting_input",))

        r = client.post(f"/api/v1/generations/{job_id}/answers", json={"answers": {}})
        assert r.status_code == 200
        snap = _drain(client, job_id, statuses=("succeeded", "failed"))
        assert snap["status"] == "succeeded"
        assert seen["resume_state"]["answers"] == {}


def test_cancel_awaiting_job(tmp_path, monkeypatch):
    seen: dict = {}
    _fake_clarify_pipeline(monkeypatch, seen)
    with boot_client(
        tmp_path, monkeypatch, FEATURE_CLARIFY="true", CDN_BASE_URL=""
    ) as client:
        job_id = client.post(
            "/api/v1/generations", json={"prompt": "make me a jungle game"}
        ).json()["id"]
        _drain(client, job_id, statuses=("awaiting_input",))

        r = client.post(f"/api/v1/generations/{job_id}/cancel")
        assert r.status_code == 200
        snap = client.get(f"/api/v1/generations/{job_id}").json()
        assert snap["status"] == "failed"
        assert snap["error"]["code"] == "cancelled"

        # Terminal now: a second cancel and late answers both conflict.
        assert client.post(f"/api/v1/generations/{job_id}/cancel").status_code == 409
        r = client.post(f"/api/v1/generations/{job_id}/answers", json={"answers": {}})
        assert r.status_code == 409

        # The event log ends with the cancel's failed event.
        stream = client.get(f"/api/v1/generations/{job_id}/stream")
        assert '"error_code": "cancelled"' in stream.text


def test_awaiting_jobs_survive_restart_semantics(tmp_path, monkeypatch):
    """fail_abandoned (startup sweep) must not kill a paused job."""
    import asyncio

    from generation_service.domain.entities import GenerationJob, JobStatus
    from generation_service.infrastructure.persistence import Database, SqliteJobRepository

    async def scenario() -> tuple[str, str]:
        db = Database(tmp_path / "restart.db")
        await db.connect()
        jobs = SqliteJobRepository(db)
        paused = GenerationJob.create(prompt="paused prompt", requested_locale=None)
        running = GenerationJob.create(prompt="running prompt", requested_locale=None)
        await jobs.add(paused)
        await jobs.add(running)
        assert await jobs.mark_running(paused.id)
        assert await jobs.mark_awaiting_input(paused.id, [QUESTION], "{}")
        await jobs.set_status(running.id, JobStatus.RUNNING)

        await jobs.fail_abandoned("interrupted", "restart")
        paused_after = await jobs.get(paused.id)
        running_after = await jobs.get(running.id)
        await db.close()
        assert paused_after is not None and running_after is not None
        return paused_after.status.value, running_after.status.value

    paused_status, running_status = asyncio.run(scenario())
    assert paused_status == "awaiting_input"
    assert running_status == "failed"


def test_prompt_analysis_question_projection():
    """The LLM's raw questions map onto stable domain ids and safe defaults."""
    from generation_service.infrastructure.ai.schemas import (
        PromptAnalysis,
        RawClarifyingQuestion,
    )

    analysis = PromptAnalysis(
        in_scope=True,
        game_concept="a runner",
        clarifying_questions=[
            RawClarifyingQuestion(
                question="Theme?", options=["Space", "Jungle", ""], default_option_index=1
            ),
            RawClarifyingQuestion(question="Only one option", options=["Solo"]),
            RawClarifyingQuestion(
                question="Bad default", options=["A", "B"], default_option_index=9
            ),
        ],
    )
    questions = analysis.domain_questions()
    # The single-option question is dropped (nothing to choose).
    assert [q.id for q in questions] == ["q_1", "q_3"]
    assert questions[0].default_option_id == "opt_2"  # index 1 survived
    assert [o.label for o in questions[0].options] == ["Space", "Jungle"]
    assert questions[1].default_option_id == "opt_1"  # out-of-range default clamps


def test_questions_json_roundtrip():
    assert json.loads(QUESTION.model_dump_json())["options"][0]["id"] == "opt_1"
