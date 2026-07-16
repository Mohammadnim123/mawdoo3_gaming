"""Image attachments on tweaks: normalization + threading into the LLM calls.

The LLM layer is stubbed at StructuredLlm.generate, so the REAL pipeline runs
(revise blueprint → codegen → gate → package → store) and the stub can assert
which stages received the normalized image. A message-level test against a
fake Anthropic client verifies the actual image content block shape.
"""

from __future__ import annotations

import base64
import io

import pytest
from PIL import Image
from tests.conftest import boot_client, build_sample_blueprint, drain_job

from generation_service.domain.blueprint import GameBlueprint
from generation_service.domain.entities import GeneratedGameCode, LlmUsage
from generation_service.domain.errors import InvalidPromptError
from generation_service.infrastructure.images import normalize_image_b64

PASSING_JS = """\
window.createGame = function ({ mount, sdk }) {
  var label = document.createElement('div');
  label.textContent = sdk.t('title');
  mount.appendChild(label);
  sdk.ready();
  return { destroy: function () {} };
};
"""


def _png_b64(width: int = 64, height: int = 48) -> str:
    image = Image.new("RGB", (width, height), (200, 30, 30))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return base64.b64encode(out.getvalue()).decode()


def _stub_llm(monkeypatch, seen: dict):
    """Record the image each stage received; return schema-appropriate artifacts."""
    from generation_service.infrastructure.ai.llm import StructuredLlm
    from generation_service.infrastructure.ai.schemas import PromptAnalysis, ReviewVerdict

    async def fake_generate(
        self, stage, system, user, schema, image_b64=None, image_media_type="image/webp"
    ):
        seen.setdefault(stage, []).append(image_b64)
        usage = LlmUsage(stage=stage, model="fake")
        if schema is PromptAnalysis:
            return PromptAnalysis(in_scope=True, game_concept="a jungle runner"), usage
        if schema is GameBlueprint:
            return build_sample_blueprint(), usage
        if schema is GeneratedGameCode:
            return GeneratedGameCode(game_js=PASSING_JS, game_css=""), usage
        if schema is ReviewVerdict:
            return ReviewVerdict(passed=True, issues=[]), usage
        raise AssertionError(f"unexpected schema {schema}")

    monkeypatch.setattr(StructuredLlm, "generate", fake_generate)


def _boot(tmp_path, monkeypatch):
    return boot_client(
        tmp_path,
        monkeypatch,
        FEATURE_TWEAKS_API="true",
        FEATURE_CLARIFY="false",
        FEATURE_LLM_REVIEW="false",
        GATE_SMOKE_BOOT="false",
        CDN_BASE_URL="",
    )


def test_tweak_threads_image_into_tweak_llm_calls(tmp_path, monkeypatch):
    seen: dict = {}
    _stub_llm(monkeypatch, seen)
    with _boot(tmp_path, monkeypatch) as client:
        # Create the base game — no image anywhere on the create path.
        job = client.post(
            "/api/v1/generations", json={"prompt": "make me a jungle game"}
        ).json()
        snap = drain_job(client, job["id"])
        assert snap["status"] == "succeeded", snap
        game_id = snap["game_id"]
        assert seen["blueprint"] == [None]
        assert seen["code_generation"] == [None]

        # Tweak with a data-URL reference image.
        r = client.post(
            f"/api/v1/games/{game_id}/tweaks",
            json={
                "instruction": "make the background look like this at night",
                "image_base64": "data:image/png;base64," + _png_b64(2000, 1200),
            },
        )
        assert r.status_code == 202, r.text
        snap = drain_job(client, r.json()["id"])
        assert snap["status"] == "succeeded", snap

        # Both tweak-related generations saw the image; it was normalized
        # (WebP, long edge capped at 1568) before reaching the model.
        revise_image = seen["blueprint_revision"][0]
        codegen_image = seen["code_generation"][-1]
        assert revise_image is not None
        assert codegen_image == revise_image
        with Image.open(io.BytesIO(base64.b64decode(revise_image))) as normalized:
            assert normalized.format == "WEBP"
            assert max(normalized.size) <= 1568


def test_tweak_without_image_stays_inert(tmp_path, monkeypatch):
    seen: dict = {}
    _stub_llm(monkeypatch, seen)
    with _boot(tmp_path, monkeypatch) as client:
        job = client.post(
            "/api/v1/generations", json={"prompt": "make me a jungle game"}
        ).json()
        snap = drain_job(client, job["id"])
        game_id = snap["game_id"]

        r = client.post(
            f"/api/v1/games/{game_id}/tweaks", json={"instruction": "make it faster"}
        )
        assert r.status_code == 202
        snap = drain_job(client, r.json()["id"])
        assert snap["status"] == "succeeded"
        assert seen["blueprint_revision"] == [None]
        assert all(image is None for image in seen["code_generation"])


def test_tweak_rejects_broken_image_before_creating_a_job(tmp_path, monkeypatch):
    seen: dict = {}
    _stub_llm(monkeypatch, seen)
    with _boot(tmp_path, monkeypatch) as client:
        job = client.post(
            "/api/v1/generations", json={"prompt": "make me a jungle game"}
        ).json()
        game_id = drain_job(client, job["id"])["game_id"]

        r = client.post(
            f"/api/v1/games/{game_id}/tweaks",
            json={"instruction": "make it faster", "image_base64": "!!!not-base64!!!"},
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "invalid_prompt"
        # No tweak run started: the LLM never saw a revision call.
        assert "blueprint_revision" not in seen


# --------------------------------------------------------------------------- #
# The LLM adapter's message shape (the actual image content block)
# --------------------------------------------------------------------------- #


async def test_generate_builds_anthropic_image_block():
    from tests.test_llm import Artifact, FakeResponse, make_llm

    llm, client = make_llm([FakeResponse({"name": "snake", "score": 3})])
    await llm.generate("stage", "sys", "user text", Artifact, image_b64="QUJD")
    content = client.messages.calls[0]["messages"][0]["content"]
    assert content == [
        {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/webp", "data": "QUJD"},
        },
        {"type": "text", "text": "user text"},
    ]


async def test_generate_without_image_keeps_plain_string_content():
    from tests.test_llm import Artifact, FakeResponse, make_llm

    llm, client = make_llm([FakeResponse({"name": "snake", "score": 3})])
    await llm.generate("stage", "sys", "user text", Artifact)
    assert client.messages.calls[0]["messages"][0]["content"] == "user text"


# --------------------------------------------------------------------------- #
# Normalization unit behavior
# --------------------------------------------------------------------------- #


def test_normalize_accepts_raw_and_data_url_and_caps_long_edge():
    raw = _png_b64(2000, 1000)
    for payload in (raw, "data:image/png;base64," + raw):
        normalized = normalize_image_b64(payload)
        with Image.open(io.BytesIO(base64.b64decode(normalized))) as image:
            assert image.format == "WEBP"
            assert image.size == (1568, 784)

    # Small images are never upscaled.
    small = normalize_image_b64(_png_b64(64, 48))
    with Image.open(io.BytesIO(base64.b64decode(small))) as image:
        assert image.size == (64, 48)


def test_normalize_rejects_garbage_and_oversize():
    with pytest.raises(InvalidPromptError):
        normalize_image_b64("!!!not-base64!!!")
    with pytest.raises(InvalidPromptError):
        normalize_image_b64(base64.b64encode(b"plain text, not an image").decode())
    with pytest.raises(InvalidPromptError):
        normalize_image_b64("")
    with pytest.raises(InvalidPromptError):
        normalize_image_b64("A" * 8_000_001)


def test_request_schema_caps_image_length(tmp_path, monkeypatch):
    with _boot(tmp_path, monkeypatch) as client:
        r = client.post(
            "/api/v1/games/whatever/tweaks",
            json={"instruction": "make it faster", "image_base64": "A" * 8_000_001},
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "validation_error"
