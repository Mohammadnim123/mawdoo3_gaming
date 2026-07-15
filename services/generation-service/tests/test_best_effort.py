"""Best-effort publishing when gate retries are exhausted.

The gate raises quality through retries; it does not take the game away from
the creator. An attempt failing only advisory checks (lifecycle, i18n, size,
ready(), deep review) is published anyway — only unsafe-or-unrunnable
attempts (BLOCKING_CHECK_IDS) leave the job failed.
"""

from __future__ import annotations

from generation_service.domain.entities import (
    FailureCode,
    GateCheck,
    GateReport,
    GeneratedGameCode,
)
from generation_service.infrastructure.ai.nodes import GenerationNodes
from generation_service.infrastructure.ai.schemas import ReviewIssue, ReviewVerdict


def advisory_report(*, passed: bool = False, failures: int = 1) -> GateReport:
    checks = [
        GateCheck(check_id="i18n.strings_used", passed=passed, detail="" if passed else "x")
        for _ in range(max(1, failures))
    ]
    return GateReport(passed=passed, checks=checks)


def blocking_report() -> GateReport:
    return GateReport(
        passed=False,
        checks=[GateCheck(check_id="syntax.node_check", passed=False, detail="SyntaxError")],
    )


class FakeGate:
    def __init__(self, report: GateReport) -> None:
        self._report = report

    async def run(self, blueprint, code) -> GateReport:
        return self._report


class FakeLlm:
    def __init__(self, result) -> None:
        self._result = result

    async def generate(self, stage, system, user, schema):
        return self._result, None


class NullStorage:
    async def put(self, key, data, content_type) -> None:
        return None

    async def get(self, key) -> bytes:
        raise KeyError(key)


class NullLog:
    async def record(self, job_id, usage) -> None:
        return None


def make_nodes(gate: GateReport | None = None, review=None) -> GenerationNodes:
    return GenerationNodes(
        understanding_llm=None,
        blueprint_llm=FakeLlm(review) if review is not None else None,
        code_llm=None,
        gate=FakeGate(gate) if gate is not None else None,
        assembler=None,
        storage=NullStorage(),
        llm_log=NullLog(),
    )


def base_state(**extra) -> dict:
    return {
        "job_id": "j",
        "game_id": "g",
        "blueprint": None,
        "code": GeneratedGameCode(game_js="var current = 1;"),
        "code_attempts": 1,
        **extra,
    }


# --------------------------------------------------------------------------- #
# GateReport classification
# --------------------------------------------------------------------------- #


def test_advisory_failures_are_shippable():
    report = advisory_report()
    assert not report.passed
    assert report.shippable
    assert report.blocking_failures == []


def test_blocking_failures_are_not_shippable():
    report = blocking_report()
    assert not report.shippable
    assert [c.check_id for c in report.blocking_failures] == ["syntax.node_check"]


# --------------------------------------------------------------------------- #
# validate: best-attempt tracking
# --------------------------------------------------------------------------- #


async def test_validate_tracks_shippable_attempt_as_best():
    report = advisory_report()
    state = base_state()
    update = await make_nodes(gate=report).validate(state)
    assert update["best_code"] is state["code"]
    assert update["best_report"] is report


async def test_validate_never_tracks_blocking_attempt():
    update = await make_nodes(gate=blocking_report()).validate(base_state())
    assert "best_code" not in update
    assert "best_report" not in update


async def test_validate_keeps_the_attempt_with_fewest_failures():
    worse = advisory_report(failures=2)
    prior_code = GeneratedGameCode(game_js="var prior = 1;")
    state = base_state(best_code=prior_code, best_report=advisory_report(failures=1))
    update = await make_nodes(gate=worse).validate(state)
    assert "best_code" not in update  # 2 failures does not beat 1


async def test_validate_prefers_the_newest_attempt_on_ties():
    state = base_state(
        best_code=GeneratedGameCode(game_js="var prior = 1;"),
        best_report=advisory_report(failures=1),
    )
    update = await make_nodes(gate=advisory_report(failures=1)).validate(state)
    assert update["best_code"] is state["code"]


# --------------------------------------------------------------------------- #
# deep_review: the tracked best attempt's report stays complete
# --------------------------------------------------------------------------- #


async def test_deep_review_refreshes_best_report_for_current_code(sample_blueprint):
    verdict = ReviewVerdict(
        passed=False,
        issues=[ReviewIssue(rule="core_rule", problem="p", fix_hint="f")],
    )
    clean = advisory_report(passed=True)
    state = base_state(
        blueprint=sample_blueprint,
        gate_report=clean,
        best_report=clean,
    )
    state["best_code"] = state["code"]
    update = await make_nodes(review=verdict).deep_review(state)
    assert not update["gate_report"].passed
    assert update["best_report"] is update["gate_report"]


# --------------------------------------------------------------------------- #
# salvage: publish the best attempt, fail only when nothing is shippable
# --------------------------------------------------------------------------- #


async def test_salvage_publishes_the_best_attempt():
    best_code = GeneratedGameCode(game_js="var best = 1;")
    best_report = advisory_report()
    state = base_state(
        code_attempts=3,
        gate_report=best_report,
        best_code=best_code,
        best_report=best_report,
    )
    update = await make_nodes().salvage_best_effort(state)
    assert "failure" not in update
    assert update["code"] is best_code
    assert update["gate_report"] is best_report


async def test_salvage_without_shippable_attempt_fails():
    state = base_state(code_attempts=3, gate_report=blocking_report())
    update = await make_nodes().salvage_best_effort(state)
    assert update["failure"].code == FailureCode.GATE_FAILED
    assert "code" not in update
