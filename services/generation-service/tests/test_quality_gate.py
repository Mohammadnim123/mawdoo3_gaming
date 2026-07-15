from __future__ import annotations

import shutil

import pytest

from generation_service.domain.entities import GeneratedGameCode
from generation_service.infrastructure.validation.gate import QualityGate


def make_gate(**overrides) -> QualityGate:
    kwargs = {"node_syntax_check": True, "max_game_kb": 256}
    kwargs.update(overrides)
    return QualityGate(**kwargs)


async def test_valid_game_passes(sample_blueprint, valid_game_code):
    report = await make_gate().run(sample_blueprint, valid_game_code)
    assert report.passed, report.feedback()


async def test_missing_entrypoint_fails(sample_blueprint):
    code = GeneratedGameCode(game_js="var x = 1; sdk.ready();")
    report = await make_gate().run(sample_blueprint, code)
    assert not report.passed
    assert any(c.check_id == "contract.create_game" for c in report.failures)


async def test_network_access_fails(sample_blueprint, valid_game_code):
    code = GeneratedGameCode(
        game_js=valid_game_code.game_js + "\nfetch('/steal');",
        game_css=valid_game_code.game_css,
    )
    report = await make_gate().run(sample_blueprint, code)
    assert not report.passed
    assert any(c.check_id == "sandbox.forbidden_api" for c in report.failures)


async def test_raw_timer_fails(sample_blueprint, valid_game_code):
    code = GeneratedGameCode(
        game_js=valid_game_code.game_js + "\nsetInterval(function () {}, 100);",
    )
    report = await make_gate().run(sample_blueprint, code)
    assert not report.passed
    assert any(c.check_id == "lifecycle.sdk_managed" for c in report.failures)


async def test_external_url_fails(sample_blueprint, valid_game_code):
    code = GeneratedGameCode(
        game_js=valid_game_code.game_js,
        game_css="body { background: url('https://cdn.example.com/bg.png'); }",
    )
    report = await make_gate().run(sample_blueprint, code)
    assert not report.passed


async def test_unlocalized_game_fails(sample_blueprint):
    code = GeneratedGameCode(
        game_js="window.createGame = function ({ mount, sdk }) { sdk.ready(); return {}; };"
    )
    report = await make_gate().run(sample_blueprint, code)
    assert not report.passed
    assert any(c.check_id == "i18n.strings_used" for c in report.failures)


async def test_destructured_sdk_ready_and_t_pass(sample_blueprint):
    # A working game may destructure the SDK helpers; the contract checks
    # must recognize the aliased call sites instead of rejecting the game.
    code = GeneratedGameCode(
        game_js=(
            "window.createGame = function ({ mount, sdk }) {\n"
            "  const { ready, t } = sdk;\n"
            "  mount.textContent = t('score_label');\n"
            "  ready();\n"
            "  return {};\n"
            "};"
        )
    )
    report = await make_gate(smoke_boot=False).run(sample_blueprint, code)
    checks = {c.check_id: c.passed for c in report.checks}
    assert checks["contract.ready"], report.feedback()
    assert checks["i18n.strings_used"], report.feedback()


async def test_optional_chained_sdk_ready_passes(sample_blueprint):
    code = GeneratedGameCode(
        game_js=(
            "window.createGame = function ({ mount, sdk }) {\n"
            "  mount.textContent = sdk.t('score_label');\n"
            "  sdk?.ready();\n"
            "  return {};\n"
            "};"
        )
    )
    report = await make_gate(smoke_boot=False).run(sample_blueprint, code)
    checks = {c.check_id: c.passed for c in report.checks}
    assert checks["contract.ready"], report.feedback()


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
async def test_bare_window_globals_pass_smoke_boot(sample_blueprint):
    # window IS the global object in a browser: bare devicePixelRatio /
    # innerWidth / Path2D are valid game code and must not crash the harness.
    code = GeneratedGameCode(
        game_js=(
            "window.createGame = function ({ mount, sdk }) {\n"
            "  const canvas = document.createElement('canvas');\n"
            "  canvas.width = innerWidth * devicePixelRatio;\n"
            "  canvas.height = innerHeight * devicePixelRatio;\n"
            "  const hitbox = new Path2D();\n"
            "  mount.appendChild(canvas);\n"
            "  mount.textContent = sdk.t('score_label');\n"
            "  sdk.ready();\n"
            "  return {};\n"
            "};"
        )
    )
    report = await make_gate().run(sample_blueprint, code)
    checks = {c.check_id: c for c in report.checks}
    assert checks["runtime.smoke_boot"].passed, checks["runtime.smoke_boot"].detail


async def test_game_never_calling_ready_still_fails(sample_blueprint):
    code = GeneratedGameCode(
        game_js=(
            "window.createGame = function ({ mount, sdk }) {\n"
            "  mount.textContent = sdk.t('score_label');\n"
            "  return {};\n"
            "};"
        )
    )
    report = await make_gate(smoke_boot=False).run(sample_blueprint, code)
    assert not report.passed
    assert any(c.check_id == "contract.ready" for c in report.failures)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
async def test_syntax_error_fails(sample_blueprint, valid_game_code):
    code = GeneratedGameCode(game_js=valid_game_code.game_js + "\nfunction broken( {")
    report = await make_gate().run(sample_blueprint, code)
    assert not report.passed
    syntax = [c for c in report.checks if c.check_id == "syntax.node_check"]
    assert syntax and not syntax[0].passed


async def test_size_cap(sample_blueprint, valid_game_code):
    code = GeneratedGameCode(
        game_js=valid_game_code.game_js + "\n// " + "x" * 2048,
    )
    report = await make_gate(max_game_kb=1).run(sample_blueprint, code)
    assert not report.passed
    assert any(c.check_id == "bundle.size" for c in report.failures)


async def test_feedback_is_actionable(sample_blueprint):
    code = GeneratedGameCode(game_js="setTimeout(function () {}, 1);")
    report = await make_gate().run(sample_blueprint, code)
    feedback = report.feedback()
    assert "sdk.after" in feedback
    assert "window.createGame" in feedback


async def test_set_animation_loop_fails(sample_blueprint, valid_game_code):
    code = GeneratedGameCode(
        game_js=valid_game_code.game_js + "\nrenderer.setAnimationLoop(tick);",
    )
    report = await make_gate().run(sample_blueprint, code)
    assert not report.passed
    assert any("sdk.loop" in c.detail for c in report.failures)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
async def test_crash_on_first_frame_fails_smoke_boot(sample_blueprint):
    # Valid syntax, valid contract — but the render loop dereferences state
    # that is only initialized after the player starts.
    code = GeneratedGameCode(
        game_js="""\
window.createGame = function ({ mount, sdk }) {
  var cue = null;
  var label = document.createElement('div');
  label.textContent = sdk.t('title');
  mount.appendChild(label);
  sdk.on(mount, 'pointerdown', function () { cue = { alive: true }; });
  sdk.loop(function () {
    if (cue.alive) { label.textContent = sdk.formatNumber(1); }
  });
  sdk.ready();
  return {};
};
"""
    )
    report = await make_gate().run(sample_blueprint, code)
    assert not report.passed
    runtime = [c for c in report.checks if c.check_id == "runtime.smoke_boot"]
    assert runtime and not runtime[0].passed
    assert "crash" in runtime[0].detail


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
async def test_crash_in_input_handler_fails_smoke_boot(sample_blueprint):
    code = GeneratedGameCode(
        game_js="""\
window.createGame = function ({ mount, sdk }) {
  var state;
  var label = document.createElement('div');
  label.textContent = sdk.t('title');
  mount.appendChild(label);
  sdk.on(mount, 'pointerdown', function (ev) {
    state.taps += 1;
  });
  sdk.ready();
  return {};
};
"""
    )
    report = await make_gate().run(sample_blueprint, code)
    assert not report.passed
    assert any(c.check_id == "runtime.smoke_boot" and not c.passed for c in report.failures)


async def test_smoke_boot_disabled_skips(sample_blueprint, valid_game_code):
    report = await make_gate(smoke_boot=False).run(sample_blueprint, valid_game_code)
    runtime = [c for c in report.checks if c.check_id == "runtime.smoke_boot"]
    assert not runtime or runtime[0].detail == "skipped"


async def test_svg_namespace_url_is_allowed(sample_blueprint, valid_game_code):
    # createElementNS is sanctioned by the code prompt; its W3C namespace
    # identifier must not trip the external-URL ban.
    code = GeneratedGameCode(
        game_js=valid_game_code.game_js
        + "\nvar svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');",
        game_css=valid_game_code.game_css,
    )
    report = await make_gate(node_syntax_check=False).run(sample_blueprint, code)
    assert not any(
        c.check_id == "sandbox.forbidden_api" for c in report.failures
    ), report.feedback()


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
async def test_hanging_game_fails_smoke_boot(sample_blueprint):
    # An infinite loop inside an update callback must FAIL the gate (and the
    # spawned node process must be reaped), never pass as 'skipped'.
    code = GeneratedGameCode(
        game_js="""\
window.createGame = function ({ mount, sdk }) {
  var label = document.createElement('div');
  label.textContent = sdk.t('title');
  mount.appendChild(label);
  sdk.loop(function () { while (true) {} });
  sdk.ready();
  return {};
};
"""
    )
    gate = make_gate(smoke_boot_timeout_seconds=3)
    report = await gate.run(sample_blueprint, code)
    runtime = [c for c in report.checks if c.check_id == "runtime.smoke_boot"]
    assert runtime and not runtime[0].passed
    assert "freezes" in runtime[0].detail
