"""PUT /api/v1/games/{id}/source — hand-editing through the static gate.

The gate runs for REAL here (only the node subprocess checks are disabled for
determinism): a clean edit lands as an immutable v(N+1) with the current
pointer flipped, a gate violation is a 422 with Codply-style findings
({rule, line, snippet}) and no new version. No LLM is anywhere on this path —
the pipeline is faked only to create the base game.
"""

from __future__ import annotations

from tests.conftest import boot_client
from tests.test_draft_events_cover_api import _create_game, _fake_codegen_pipeline

VALID_JS = """\
window.createGame = function ({ mount, sdk }) {
  var label = document.createElement('div');
  label.textContent = sdk.t('title');
  mount.appendChild(label);
  var off = sdk.on(mount, 'pointerdown', function () {
    sdk.audio.beep({ freq: 520 });
    label.textContent = sdk.t('game_over');
  });
  sdk.ready();
  return { destroy: function () { off(); } };
};
"""


def _boot(tmp_path, monkeypatch):
    return boot_client(
        tmp_path, monkeypatch, CDN_BASE_URL="", GATE_SMOKE_BOOT="false"
    )


def test_put_source_happy_path_creates_next_version(tmp_path, monkeypatch):
    _fake_codegen_pipeline(monkeypatch, tmp_path / "storage")
    with _boot(tmp_path, monkeypatch) as client:
        game_id, _ = _create_game(client)

        r = client.put(
            f"/api/v1/games/{game_id}/source",
            json={"game_js": VALID_JS, "game_css": ".edited { color: red; }"},
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert set(body) == {"version_id", "play_url"}
        assert f"/g/{game_id}/v2/index.html" in body["play_url"]

        # v2 exists, is current, and is attributed to the hand edit.
        versions = client.get(f"/api/v1/games/{game_id}/versions").json()
        assert [v["version_no"] for v in versions["items"]] == [1, 2]
        v1, v2 = versions["items"]
        assert v2["id"] == body["version_id"]
        assert v2["parent_id"] == v1["id"]
        assert v2["change_summary"] == "Hand-edited"
        assert versions["current_version_id"] == v2["id"]

        # The stored bundle genuinely carries the edited code (real files).
        assert client.get(f"/g/{game_id}/v2/game.js").text == VALID_JS
        assert ".edited" in client.get(f"/g/{game_id}/v2/game.css").text
        page = client.get(f"/g/{game_id}/v2/index.html")
        assert page.status_code == 200

        # The game now plays the edited version; the hand-edit also got a cover.
        game = client.get(f"/api/v1/games/{game_id}").json()
        assert f"/g/{game_id}/v2/index.html" in game["play_url"]
        assert game["cover_url"].endswith(f"/g/{game_id}/v2/cover.svg")

        # v1 stays playable — versions are immutable.
        assert client.get(f"/g/{game_id}/v1/index.html").status_code == 200


def test_put_source_gate_violation_is_422_with_findings(tmp_path, monkeypatch):
    _fake_codegen_pipeline(monkeypatch, tmp_path / "storage")
    with _boot(tmp_path, monkeypatch) as client:
        game_id, _ = _create_game(client)

        bad_js = (
            "window.createGame = function ({ mount, sdk }) {\n"
            "  fetch('/steal');\n"
            "  setTimeout(function () {}, 100);\n"
            "  sdk.ready();\n"
            "};\n"
        )
        r = client.put(f"/api/v1/games/{game_id}/source", json={"game_js": bad_js})
        assert r.status_code == 422
        error = r.json()["error"]
        assert error["code"] == "validation_error"
        assert error["message"]
        findings = error["details"]["findings"]
        assert findings and all(set(f) == {"rule", "line", "snippet"} for f in findings)

        # Pattern findings carry the real offending line + snippet.
        fetch_finding = next(
            f for f in findings if f["rule"] == "sandbox.forbidden_api" and "fetch" in f["snippet"]
        )
        assert fetch_finding["line"] == 2
        timeout_finding = next(
            f for f in findings if f["rule"] == "lifecycle.sdk_managed"
        )
        assert timeout_finding["line"] == 3
        assert "setTimeout" in timeout_finding["snippet"]

        # Nothing was published: no v2, pointer unchanged.
        versions = client.get(f"/api/v1/games/{game_id}/versions").json()
        assert [v["version_no"] for v in versions["items"]] == [1]
        game = client.get(f"/api/v1/games/{game_id}").json()
        assert f"/g/{game_id}/v1/index.html" in game["play_url"]


def test_put_source_unknown_game_404_and_validation(tmp_path, monkeypatch):
    with _boot(tmp_path, monkeypatch) as client:
        r = client.put("/api/v1/games/nope/source", json={"game_js": VALID_JS})
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "not_found"

        # Request-shape validation still uses the one envelope.
        r = client.put("/api/v1/games/nope/source", json={"game_css": ".x{}"})
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "validation_error"
