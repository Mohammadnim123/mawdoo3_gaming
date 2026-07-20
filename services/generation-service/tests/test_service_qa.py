"""End-to-end service QA — the async job lifecycle + SSE event stream over HTTP.

Deterministic and offline: the pipeline is faked so no LLM/network is needed.
Exercises: 202 accept → background run → terminal status → error envelope →
persisted event log → SSE replay (step + failed) → service-token boundary.
"""

from __future__ import annotations

from tests.conftest import boot_client, drain_job


def _fake_pipeline(monkeypatch, *, outcome: str):
    """Replace GenerationPipeline.astream with a deterministic node stream."""
    from generation_service.domain.entities import (
        FailureCode,
        PipelineFailure,
        PipelineStage,
    )
    from generation_service.infrastructure.ai.pipeline import GenerationPipeline

    async def fake_astream(self, state):
        # Emits the 'understand' step (→ SSE step event) then a terminal failure.
        yield ("understand", {})
        yield (
            "understand",
            {"failure": PipelineFailure(
                code=FailureCode.OUT_OF_SCOPE,
                message="That prompt can't be turned into a playable mini-game.",
                stage=PipelineStage.UNDERSTANDING,
            )},
        )

    monkeypatch.setattr(GenerationPipeline, "astream", fake_astream)


def _drain(client, job_id, statuses=("succeeded", "failed"), tries=100):
    return drain_job(client, job_id, statuses=statuses, tries=tries)


def test_generation_lifecycle_events_and_sse(tmp_path, monkeypatch):
    _fake_pipeline(monkeypatch, outcome="failed")
    with boot_client(tmp_path, monkeypatch) as client:
        r = client.post("/api/v1/generations", json={"prompt": "make me a full 3D open-world MMO"})
        assert r.status_code == 202
        job_id = r.json()["id"]

        snap = _drain(client, job_id)
        assert snap["status"] == "failed"
        assert snap["error"]["code"] == "out_of_scope"

        # SSE replay: the job is terminal, so the stream replays the log and closes.
        stream = client.get(f"/api/v1/generations/{job_id}/stream")
        assert stream.status_code == 200
        body = stream.text
        assert "event: step" in body
        assert "event: failed" in body
        assert "id: " in body  # each event carries its seq as the SSE id


def test_service_token_boundary(tmp_path, monkeypatch):
    _fake_pipeline(monkeypatch, outcome="failed")
    with boot_client(tmp_path, monkeypatch, SERVICE_TOKEN="s3cr3t") as client:
        # No token → 401 on the guarded API.
        assert client.get("/api/v1/games").status_code == 401
        # Correct token → allowed.
        ok = client.get("/api/v1/games", headers={"X-Service-Token": "s3cr3t"})
        assert ok.status_code == 200
        # Health stays public.
        assert client.get("/health").status_code == 200


def test_health_and_error_envelope(tmp_path, monkeypatch):
    with boot_client(tmp_path, monkeypatch) as client:
        assert client.get("/health").json()["status"] == "ok"
        assert client.get("/api/v1/games/nope").json()["error"]["code"] == "not_found"
