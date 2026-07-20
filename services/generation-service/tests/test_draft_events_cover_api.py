"""Feature coverage: post-codegen `file` SSE events + live draft snapshots,
the JSON event-log endpoint, and cover art (cover.png / cover.svg + cover_url).

Deterministic and offline: the pipeline is faked but yields the same node
names / state updates the real one streams (generate_code → package → store),
so every hook in the run driver is exercised for real — event log, draft
store, cover writing, done payload — against genuine stored files.
"""

from __future__ import annotations

from tests.conftest import boot_client, build_sample_blueprint, drain_job

from generation_service.domain.entities import GeneratedGameCode
from generation_service.infrastructure.packaging.cover import (
    BRAND_GRADIENT,
    derive_cover_colors,
    make_cover_svg,
)

TWO_COLOR_STYLE = "neon look, palette bg #112233 / primary #AABBCC / accent #112233"


def _fake_codegen_pipeline(
    monkeypatch, storage_dir, *, with_bg=False, with_cover=False, style=None
):
    """Complete every run successfully through the codegen/package/store node
    sequence, writing a tiny real bundle to the driver-chosen target prefix."""
    from generation_service.infrastructure.ai.pipeline import GenerationPipeline

    async def fake_astream(self, state):
        blueprint = build_sample_blueprint()
        if style is not None:
            blueprint = blueprint.model_copy(update={"visual_style": style})
        marker = state.get("tweak_instruction", "v1")
        prefix = state["target_prefix"]
        code = GeneratedGameCode(game_js=f"// build {marker}\n", game_css=".x{}\n")
        yield ("blueprint", {"blueprint": blueprint})
        if with_cover:
            yield ("paint_background", {"cover_art": b"\x89PNG-fake-poster"})
        yield ("generate_code", {"code": code, "code_attempts": 1})
        bundle = {
            "index.html": f"<!doctype html><title>{marker}</title>".encode(),
            "game.js": code.game_js.encode(),
            "game.css": code.game_css.encode(),
        }
        if with_bg:
            bundle["bg.png"] = b"\x89PNG-fake-backdrop"
        yield ("package", {"bundle_files": bundle})
        for rel, body in bundle.items():
            path = storage_dir / prefix / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
        yield ("store", {"stored_prefix": prefix})

    monkeypatch.setattr(GenerationPipeline, "astream", fake_astream)


def _create_game(client) -> tuple[str, str]:
    job = client.post("/api/v1/generations", json={"prompt": "make me a jungle game"}).json()
    snap = drain_job(client, job["id"])
    assert snap["status"] == "succeeded", snap
    return snap["game_id"], job["id"]


# --------------------------------------------------------------------------- #
# Feature A: draft endpoint + file events
# --------------------------------------------------------------------------- #


def test_draft_returns_files_after_codegen(tmp_path, monkeypatch):
    _fake_codegen_pipeline(monkeypatch, tmp_path / "storage")
    with boot_client(tmp_path, monkeypatch, CDN_BASE_URL="") as client:
        _, job_id = _create_game(client)

        draft = client.get(f"/api/v1/generations/{job_id}/draft").json()
        # After packaging the draft carries the assembled index as content...
        assert draft["content"].startswith("<!doctype html>")
        # ...and every human-readable bundle file, index.html first.
        paths = [f["path"] for f in draft["files"]]
        assert paths[0] == "index.html"
        assert "game.js" in paths and "game.css" in paths
        game_js = next(f for f in draft["files"] if f["path"] == "game.js")
        assert game_js["content"] == "// build v1\n"


def test_file_events_created_in_event_log_and_stream(tmp_path, monkeypatch):
    _fake_codegen_pipeline(monkeypatch, tmp_path / "storage")
    with boot_client(tmp_path, monkeypatch, CDN_BASE_URL="") as client:
        _, job_id = _create_game(client)

        events = client.get(f"/api/v1/generations/{job_id}/events").json()["items"]
        seqs = [e["seq"] for e in events]
        assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)

        file_events = [e for e in events if e["event"] == "file"]
        assert {e["data"]["path"] for e in file_events} == {"game.js", "game.css"}
        for event in file_events:
            assert event["data"]["action"] == "created"
            assert event["data"]["bytes"] > 0

        # The SSE replay carries the same persisted file events.
        stream = client.get(f"/api/v1/generations/{job_id}/stream")
        assert "event: file" in stream.text
        assert '"path": "game.js"' in stream.text


def test_tweak_draft_and_updated_file_events(tmp_path, monkeypatch):
    _fake_codegen_pipeline(monkeypatch, tmp_path / "storage")
    with boot_client(
        tmp_path, monkeypatch, FEATURE_TWEAKS_API="true", CDN_BASE_URL=""
    ) as client:
        game_id, _ = _create_game(client)

        r = client.post(
            f"/api/v1/games/{game_id}/tweaks", json={"instruction": "make it faster"}
        )
        assert r.status_code == 202
        tweak_job_id = r.json()["id"]
        snap = drain_job(client, tweak_job_id)
        assert snap["status"] == "succeeded"

        # Tweak runs report their files as "updated".
        events = client.get(f"/api/v1/generations/{tweak_job_id}/events").json()["items"]
        file_events = [e for e in events if e["event"] == "file"]
        assert file_events, "tweak run emitted no file events"
        assert all(e["data"]["action"] == "updated" for e in file_events)

        # The draft endpoint works for tweak jobs too.
        draft = client.get(f"/api/v1/generations/{tweak_job_id}/draft").json()
        game_js = next(f for f in draft["files"] if f["path"] == "game.js")
        assert game_js["content"] == "// build make it faster\n"


def test_draft_empty_before_codegen_and_404_unknown(tmp_path, monkeypatch):
    from generation_service.domain.entities import FailureCode, PipelineFailure, PipelineStage
    from generation_service.infrastructure.ai.pipeline import GenerationPipeline

    async def failing_astream(self, state):
        yield ("understand", {})
        yield ("understand", {"failure": PipelineFailure(
            code=FailureCode.OUT_OF_SCOPE, message="nope", stage=PipelineStage.UNDERSTANDING,
        )})

    monkeypatch.setattr(GenerationPipeline, "astream", failing_astream)
    with boot_client(tmp_path, monkeypatch) as client:
        job_id = client.post(
            "/api/v1/generations", json={"prompt": "make me a jungle game"}
        ).json()["id"]
        drain_job(client, job_id)

        # A job that never reached codegen has the empty draft shape.
        assert client.get(f"/api/v1/generations/{job_id}/draft").json() == {
            "content": None,
            "files": [],
        }
        # Unknown jobs 404 with the standard envelope.
        r = client.get("/api/v1/generations/nope/draft")
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "not_found"


# --------------------------------------------------------------------------- #
# Event-log endpoint (JSON replay for the web tier)
# --------------------------------------------------------------------------- #


def test_events_endpoint_returns_full_log_in_order(tmp_path, monkeypatch):
    _fake_codegen_pipeline(monkeypatch, tmp_path / "storage")
    with boot_client(tmp_path, monkeypatch, CDN_BASE_URL="") as client:
        _, job_id = _create_game(client)

        body = client.get(f"/api/v1/generations/{job_id}/events").json()
        names = [e["event"] for e in body["items"]]
        assert "step" in names and "file" in names
        assert names[-1] == "done"
        done = body["items"][-1]["data"]
        assert done["game_id"] and done["version_id"]

        r = client.get("/api/v1/generations/nope/events")
        assert r.status_code == 404


# --------------------------------------------------------------------------- #
# Feature D: cover art + cover_url
# --------------------------------------------------------------------------- #


def test_cover_png_written_from_bg_and_in_done_event(tmp_path, monkeypatch):
    _fake_codegen_pipeline(monkeypatch, tmp_path / "storage", with_bg=True)
    with boot_client(tmp_path, monkeypatch, CDN_BASE_URL="") as client:
        game_id, job_id = _create_game(client)

        # The cover is a stored copy of bg.png, next to the bundle.
        cover = client.get(f"/g/{game_id}/v1/cover.png")
        assert cover.status_code == 200
        assert cover.content == b"\x89PNG-fake-backdrop"

        game = client.get(f"/api/v1/games/{game_id}").json()
        assert game["cover_url"].endswith(f"/g/{game_id}/v1/cover.png")

        # The done SSE event carries the same absolute cover_url.
        events = client.get(f"/api/v1/generations/{job_id}/events").json()["items"]
        done = next(e for e in events if e["event"] == "done")
        assert done["data"]["cover_url"] == game["cover_url"]

        # Listing rows carry it too.
        listed = client.get("/api/v1/games").json()["items"][0]
        assert listed["cover_url"] == game["cover_url"]


def test_cover_png_is_the_painted_poster_over_the_backdrop(tmp_path, monkeypatch):
    """The dedicated feed-card poster (cover_art) is the top rung: it wins even
    when a bg.png backdrop is also present."""
    _fake_codegen_pipeline(monkeypatch, tmp_path / "storage", with_bg=True, with_cover=True)
    with boot_client(tmp_path, monkeypatch, CDN_BASE_URL="") as client:
        game_id, job_id = _create_game(client)

        cover = client.get(f"/g/{game_id}/v1/cover.png")
        assert cover.status_code == 200
        # The poster, not the backdrop copy.
        assert cover.content == b"\x89PNG-fake-poster"

        game = client.get(f"/api/v1/games/{game_id}").json()
        assert game["cover_url"].endswith(f"/g/{game_id}/v1/cover.png")


def test_cover_svg_fallback_uses_blueprint_palette(tmp_path, monkeypatch):
    _fake_codegen_pipeline(monkeypatch, tmp_path / "storage", style=TWO_COLOR_STYLE)
    with boot_client(tmp_path, monkeypatch, CDN_BASE_URL="") as client:
        game_id, job_id = _create_game(client)

        game = client.get(f"/api/v1/games/{game_id}").json()
        assert game["cover_url"].endswith(f"/g/{game_id}/v1/cover.svg")

        svg = client.get(f"/g/{game_id}/v1/cover.svg")
        assert svg.status_code == 200
        # Gradient derived from the blueprint's hex palette + the title text.
        assert "#112233" in svg.text and "#AABBCC" in svg.text
        assert "Jungle Run" in svg.text

        events = client.get(f"/api/v1/generations/{job_id}/events").json()["items"]
        done = next(e for e in events if e["event"] == "done")
        assert done["data"]["cover_url"] == game["cover_url"]


def test_cover_failure_never_fails_the_job(tmp_path, monkeypatch):
    """A broken cover write is cosmetic: the publish still succeeds, with a
    null cover_url."""
    import generation_service.application.use_cases.run_generation as rg

    async def exploding_write_cover(storage, prefix, bundle_files, blueprint, cover_art=None):
        raise RuntimeError("disk full")

    monkeypatch.setattr(rg, "write_cover", exploding_write_cover)
    _fake_codegen_pipeline(monkeypatch, tmp_path / "storage")
    with boot_client(tmp_path, monkeypatch, CDN_BASE_URL="") as client:
        game_id, job_id = _create_game(client)  # asserts status == succeeded
        game = client.get(f"/api/v1/games/{game_id}").json()
        assert game["cover_url"] is None
        events = client.get(f"/api/v1/generations/{job_id}/events").json()["items"]
        done = next(e for e in events if e["event"] == "done")
        assert done["data"]["cover_url"] is None


def test_derive_cover_colors_and_svg_escaping():
    # One distinct hex in the style → brand gradient fallback.
    assert derive_cover_colors(build_sample_blueprint()) == BRAND_GRADIENT
    two = build_sample_blueprint().model_copy(update={"visual_style": TWO_COLOR_STYLE})
    assert derive_cover_colors(two) == ("#112233", "#AABBCC")
    svg = make_cover_svg('<Snake> & "Co"', "#112233", "#AABBCC")
    assert "&lt;Snake&gt;" in svg and "&amp;" in svg and "<Snake>" not in svg


def test_cover_prompt_bakes_title_hero_and_palette():
    from generation_service.domain.blueprint import LocalizedText, SpriteBrief
    from generation_service.infrastructure.art import build_cover_prompt, cover_title

    bp = build_sample_blueprint().model_copy(
        update={
            "title": LocalizedText(en="Flick to Glory", ar="ركلة النصر"),
            "visual_style": TWO_COLOR_STYLE,
            "background_art_prompt": "sunset football stadium, golden light",
            "sprite_briefs": [
                SpriteBrief(name="striker", prompt="a cartoon soccer striker mid-kick")
            ],
        }
    )
    # Latin, uppercased — Arabic script renders as broken glyphs in image models.
    assert cover_title(bp) == "FLICK TO GLORY"

    prompt = build_cover_prompt(bp)
    assert 'reading "FLICK TO GLORY"' in prompt  # title lettered INTO the art
    assert "a cartoon soccer striker mid-kick" in prompt  # the hero is the subject
    assert "sunset football stadium" in prompt  # the game's own scene
    assert "#112233" in prompt and "#AABBCC" in prompt  # the game's own palette
    assert "no watermark" in prompt  # junk stays out — but the title does not


def test_cover_title_prefers_english_then_falls_back():
    from generation_service.domain.blueprint import LocalizedText
    from generation_service.infrastructure.art import cover_title

    ar_only = build_sample_blueprint().model_copy(
        update={"title": LocalizedText(en="", ar="لعبة"), "default_locale": "ar"}
    )
    assert cover_title(ar_only) == "لعبة"  # no English → the Arabic title, still lettered
