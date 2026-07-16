from __future__ import annotations

import time
from pathlib import Path

import pytest

from generation_service.domain.blueprint import (
    Control,
    GameBlueprint,
    Genre,
    LocalizedText,
    TweakParameter,
    UiString,
)
from generation_service.domain.entities import GeneratedGameCode

TEMPLATE_DIR = Path(__file__).resolve().parents[3] / "packages" / "starter-template"


def drain_job(client, job_id, statuses=("succeeded", "failed"), tries=100):
    """Poll a generation until it reaches one of the given statuses — the one
    shared polling helper for every app-level suite."""
    snap = client.get(f"/api/v1/generations/{job_id}").json()
    for _ in range(tries):
        if snap.get("status") in statuses:
            return snap
        time.sleep(0.05)
        snap = client.get(f"/api/v1/generations/{job_id}").json()
    return snap


def build_sample_blueprint() -> GameBlueprint:
    """A small valid blueprint usable from module scope (fixtures can't be
    called inside fake pipelines)."""
    return GameBlueprint(
        title=LocalizedText(en="Jungle Run", ar="عدّاء الأدغال"),
        genre=Genre.ARCADE,
        summary="Run through the jungle collecting fruit.",
        core_rule="Collect fruit; hitting a rock ends the run.",
        win_condition="Collect 20 fruit",
        lose_condition="Hit a rock",
        rules=["Fruit adds one point", "Rocks end the game", "Speed rises over time"],
        controls=[Control(input="touch", action="tap to jump")],
        difficulty="speed ramps",
        rendering="canvas",
        default_locale="en",
        visual_style="lowpoly-nature look, palette bg #A5D8CE etc.",
        entities=["runner", "fruit", "rock"],
        tweaks=[TweakParameter(name="speed", description="run speed", value=4)],
        ui_strings=[
            UiString(key="title", en="Jungle Run", ar="عدّاء الأدغال"),
            UiString(key="game_over", en="Game over", ar="انتهت اللعبة"),
        ],
    )


def boot_client(tmp_path, monkeypatch, **env: str):
    """Boot the real app (lifespan + container wiring) against temp dirs.

    The single test seam for app-level tests — every suite that needs a live
    TestClient uses this, so the isolation env vars can never drift apart.
    """
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "storage"))
    monkeypatch.setenv("GATE_NODE_SYNTAX_CHECK", "false")
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    from fastapi.testclient import TestClient

    from generation_service.config.settings import get_settings
    from generation_service.main import create_app

    get_settings.cache_clear()
    return TestClient(create_app())


@pytest.fixture()
def template_dir() -> Path:
    return TEMPLATE_DIR


@pytest.fixture()
def sample_blueprint() -> GameBlueprint:
    return GameBlueprint(
        title=LocalizedText(en="Number Guess", ar="تخمين الأرقام"),
        genre=Genre.PUZZLE,
        summary="Guess the secret number between 1 and 100 in as few tries as possible.",
        core_rule=(
            "After each guess the game says higher or lower; "
            "matching the secret number wins."
        ),
        win_condition="Guess the secret number",
        lose_condition="Run out of attempts",
        rules=[
            "A secret number between 1 and 100 is chosen at random",
            "Each wrong guess reveals higher/lower",
            "The player has a limited number of attempts",
        ],
        controls=[Control(input="touch", action="tap digits to enter a guess")],
        difficulty="fewer attempts on higher difficulty",
        rendering="dom",
        default_locale="ar",
        visual_style="dark background, warm accent colors, big friendly digits",
        entities=["secret number", "guess input", "attempts counter"],
        tweaks=[
            TweakParameter(name="max_attempts", description="allowed guesses", value=7),
            TweakParameter(name="max_number", description="upper bound", value=100),
        ],
        ui_strings=[
            UiString(key="title", en="Number Guess", ar="تخمين الأرقام"),
            UiString(key="guess", en="Guess", ar="خمّن"),
            UiString(key="higher", en="Higher!", ar="أعلى!"),
            UiString(key="lower", en="Lower!", ar="أقل!"),
            UiString(key="you_win", en="You win!", ar="لقد فزت!"),
            UiString(key="game_over", en="Game over", ar="انتهت اللعبة"),
        ],
    )


@pytest.fixture()
def valid_game_code() -> GeneratedGameCode:
    return GeneratedGameCode(
        game_js="""\
window.createGame = function ({ mount, sdk }) {
  var secret = sdk.randInt(1, sdk.tweaks.max_number);
  var attempts = sdk.tweaks.max_attempts;
  var label = document.createElement('div');
  label.textContent = sdk.t('title');
  mount.appendChild(label);
  var off = sdk.on(mount, 'pointerdown', function () {
    sdk.audio.beep({ freq: 520 });
    attempts -= 1;
    label.textContent = sdk.formatNumber(attempts);
    if (attempts <= 0) {
      sdk.gameOver({ score: 0, won: false });
      label.textContent = sdk.t('game_over');
    }
  });
  sdk.ready();
  return { destroy: function () { off(); } };
};
""",
        game_css=".guess { display: flex; }\n",
    )
