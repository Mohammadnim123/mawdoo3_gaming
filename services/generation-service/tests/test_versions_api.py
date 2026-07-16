"""Immutable versions over HTTP — v1 on create, v{n} on tweak, rollback, source.

Deterministic and offline: the pipeline is faked but writes REAL bundle bytes
through the container's storage (the fake receives the same target_prefix the
driver computed), so play URLs, the version catalog, rollback pointer flips,
and the source endpoint are all exercised against genuine stored files.
"""

from __future__ import annotations

from tests.conftest import boot_client, drain_job
from tests.test_clarify_api import _sample_blueprint


def _fake_store_pipeline(monkeypatch, storage_dir):
    """Complete every run successfully, writing a tiny real bundle to the
    driver-chosen target prefix. Tweaks get a revised title so rollback's
    blueprint restore is observable."""
    from generation_service.infrastructure.ai.pipeline import GenerationPipeline

    async def fake_astream(self, state):
        blueprint = _sample_blueprint()
        marker = state.get("tweak_instruction", "v1")
        prefix = state["target_prefix"]
        for rel, body in (
            ("index.html", f"<!doctype html><title>{marker}</title>"),
            ("game.js", f"// build {marker}\n"),
            ("game.css", ".x{}\n"),
        ):
            path = storage_dir / prefix / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body)
        yield ("blueprint", {"blueprint": blueprint})
        yield ("store", {"blueprint": blueprint, "stored_prefix": prefix})

    monkeypatch.setattr(GenerationPipeline, "astream", fake_astream)


def _drain(client, job_id, tries=100):
    return drain_job(client, job_id, tries=tries)


def _create_game(client) -> str:
    job = client.post("/api/v1/generations", json={"prompt": "make me a jungle game"}).json()
    snap = _drain(client, job["id"])
    assert snap["status"] == "succeeded", snap
    return snap["game_id"]


def test_create_records_v1(tmp_path, monkeypatch):
    _fake_store_pipeline(monkeypatch, tmp_path / "storage")
    with boot_client(tmp_path, monkeypatch, CDN_BASE_URL="") as client:
        game_id = _create_game(client)

        game = client.get(f"/api/v1/games/{game_id}").json()
        assert f"/g/{game_id}/v1/index.html" in game["play_url"]

        versions = client.get(f"/api/v1/games/{game_id}/versions").json()
        assert len(versions["items"]) == 1
        v1 = versions["items"][0]
        assert v1["version_no"] == 1
        assert v1["parent_id"] is None
        assert v1["change_summary"] == "Initial version"
        assert versions["current_version_id"] == v1["id"]
        assert f"/g/{game_id}/v1/index.html" in v1["play_url"]

        # The bundle is genuinely served from the versioned path.
        page = client.get(f"/g/{game_id}/v1/index.html")
        assert page.status_code == 200
        assert "v1" in page.text


def test_tweak_appends_v2_and_rollback_restores_v1(tmp_path, monkeypatch):
    _fake_store_pipeline(monkeypatch, tmp_path / "storage")
    with boot_client(
        tmp_path, monkeypatch, FEATURE_TWEAKS_API="true", CDN_BASE_URL=""
    ) as client:
        game_id = _create_game(client)

        r = client.post(
            f"/api/v1/games/{game_id}/tweaks", json={"instruction": "make it faster"}
        )
        assert r.status_code == 202
        snap = _drain(client, r.json()["id"])
        assert snap["status"] == "succeeded"

        versions = client.get(f"/api/v1/games/{game_id}/versions").json()
        assert [v["version_no"] for v in versions["items"]] == [1, 2]
        v1, v2 = versions["items"]
        assert v2["parent_id"] == v1["id"]
        assert v2["change_summary"] == "make it faster"
        assert versions["current_version_id"] == v2["id"]

        game = client.get(f"/api/v1/games/{game_id}").json()
        assert f"/g/{game_id}/v2/index.html" in game["play_url"]

        # Both bundles remain stored and playable — immutability.
        assert client.get(f"/g/{game_id}/v1/index.html").status_code == 200
        assert client.get(f"/g/{game_id}/v2/index.html").status_code == 200

        # Rollback flips the pointer back to v1 without touching bundles.
        r = client.post(f"/api/v1/games/{game_id}/rollback", json={"version_id": v1["id"]})
        assert r.status_code == 200
        assert r.json()["version_no"] == 1
        game = client.get(f"/api/v1/games/{game_id}").json()
        assert f"/g/{game_id}/v1/index.html" in game["play_url"]
        versions = client.get(f"/api/v1/games/{game_id}/versions").json()
        assert versions["current_version_id"] == v1["id"]

        # Rolling back to the current version conflicts; unknown ids 404.
        assert (
            client.post(
                f"/api/v1/games/{game_id}/rollback", json={"version_id": v1["id"]}
            ).status_code
            == 409
        )
        assert (
            client.post(
                f"/api/v1/games/{game_id}/rollback", json={"version_id": "nope"}
            ).status_code
            == 404
        )


def test_version_source_endpoint(tmp_path, monkeypatch):
    _fake_store_pipeline(monkeypatch, tmp_path / "storage")
    with boot_client(tmp_path, monkeypatch, CDN_BASE_URL="") as client:
        game_id = _create_game(client)
        versions = client.get(f"/api/v1/games/{game_id}/versions").json()
        version_id = versions["items"][0]["id"]

        source = client.get(
            f"/api/v1/games/{game_id}/versions/{version_id}/source"
        ).json()
        assert source["version_id"] == version_id
        assert source["source_html"].startswith("<!doctype html>")
        assert source["game_js"].startswith("// build")
        assert source["game_css"]

        r = client.get(f"/api/v1/games/{game_id}/versions/nope/source")
        assert r.status_code == 404
        r = client.get(f"/api/v1/games/nope/versions/{version_id}/source")
        assert r.status_code == 404


def test_versions_unknown_game_404(tmp_path, monkeypatch):
    with boot_client(tmp_path, monkeypatch, CDN_BASE_URL="") as client:
        assert client.get("/api/v1/games/nope/versions").status_code == 404
