"""Orchestrator control flow with stub nodes — no LLM, no IO.

Verifies the routing semantics the job runner depends on: entry branching
(create vs tweak), the out-of-scope terminal, the gate retry loop with its
cap, best-effort salvage when retries run out, the optional deep-review
stage, and the packaging/storage tail.
"""

from __future__ import annotations

from generation_service.domain.entities import (
    ClarifyOption,
    ClarifyQuestion,
    GateCheck,
    GateReport,
    PipelineFailure,
    PipelineStage,
)
from generation_service.infrastructure.ai.pipeline import GenerationPipeline

SAMPLE_QUESTION = ClarifyQuestion(
    id="q_1",
    question="What theme?",
    options=[ClarifyOption(id="opt_1", label="Space"), ClarifyOption(id="opt_2", label="Jungle")],
    default_option_id="opt_1",
)


class FakeAnalysis:
    """Just enough of PromptAnalysis for the pipeline's clarify branch."""

    def __init__(self, questions: list[ClarifyQuestion] | None = None) -> None:
        self._questions = questions or []
        self.game_concept = "a game"
        self.detected_language = "en"

    def domain_questions(self) -> list[ClarifyQuestion]:
        return self._questions


class StubNodes:
    """Gate passes on the Nth code attempt (never, if pass_on_attempt=0).
    Failing attempts carry an advisory failure (still shippable) unless
    blocking=True, which fails a check no game may ship with."""

    def __init__(
        self,
        pass_on_attempt: int = 1,
        in_scope: bool = True,
        blocking: bool = False,
        questions: list[ClarifyQuestion] | None = None,
    ) -> None:
        self._pass_on_attempt = pass_on_attempt
        self._in_scope = in_scope
        self._blocking = blocking
        self._questions = questions or []

    async def understand(self, state):
        if not self._in_scope:
            return {
                "failure": PipelineFailure(
                    stage=PipelineStage.UNDERSTANDING, code="out_of_scope", message="no"
                )
            }
        return {"analysis": FakeAnalysis(self._questions)}

    async def design_blueprint(self, state):
        return {"blueprint": "blueprint"}

    async def revise_blueprint(self, state):
        return {"blueprint": "revised-blueprint"}

    async def paint_background(self, state):
        return {"background_art": None}

    async def generate_code(self, state):
        return {"code": "code", "code_attempts": state.get("code_attempts", 0) + 1}

    async def validate(self, state):
        passed = self._pass_on_attempt and state["code_attempts"] >= self._pass_on_attempt
        check_id = "sandbox.forbidden_api" if self._blocking else "i18n.strings_used"
        report = GateReport(
            passed=bool(passed), checks=[GateCheck(check_id=check_id, passed=bool(passed))]
        )
        update = {"gate_report": report}
        if not report.passed and report.shippable:
            update.update(best_code=state["code"], best_report=report)
        return update

    async def deep_review(self, state):
        return {"gate_report": state["gate_report"]}

    async def salvage_best_effort(self, state):
        if state.get("best_code") is not None:
            return {"code": state["best_code"], "gate_report": state["best_report"]}
        return {
            "failure": PipelineFailure(
                stage=PipelineStage.VALIDATION, code="gate_failed", message="exhausted"
            )
        }

    async def package(self, state):
        return {"bundle_files": {}}

    async def store(self, state):
        return {"stored_prefix": "games/x"}


async def run(pipeline: GenerationPipeline, state: dict) -> list[str]:
    return [name async for name, _update in pipeline.astream(state)]


def create_state() -> dict:
    return {"job_id": "j", "game_id": "g", "prompt": "p", "mode": "create", "code_attempts": 0}


async def test_happy_path_order():
    pipeline = GenerationPipeline(StubNodes(), max_code_retries=2)
    names = await run(pipeline, create_state())
    assert names == [
        "understand",
        "blueprint",
        "paint_background",
        "generate_code",
        "validate",
        "package",
        "store",
    ]


async def test_out_of_scope_is_terminal():
    pipeline = GenerationPipeline(StubNodes(in_scope=False), max_code_retries=2)
    names = await run(pipeline, create_state())
    assert names == ["understand"]


async def test_gate_retry_then_pass():
    pipeline = GenerationPipeline(StubNodes(pass_on_attempt=2), max_code_retries=2)
    names = await run(pipeline, create_state())
    assert names.count("generate_code") == 2
    assert names[-2:] == ["package", "store"]


async def test_gate_exhausted_publishes_best_effort():
    # Advisory-only failures never strand the creator on an error: the best
    # attempt is salvaged and the pipeline continues to package/store.
    pipeline = GenerationPipeline(StubNodes(pass_on_attempt=0), max_code_retries=1)
    names = await run(pipeline, create_state())
    assert names.count("generate_code") == 2  # initial attempt + 1 retry
    assert names[-3:] == ["salvage", "package", "store"]


async def test_gate_exhausted_with_blocking_failures_is_terminal():
    # Unsafe or unrunnable on every attempt — the one case that still fails.
    pipeline = GenerationPipeline(
        StubNodes(pass_on_attempt=0, blocking=True), max_code_retries=1
    )
    names = await run(pipeline, create_state())
    assert names[-1] == "salvage"
    assert "package" not in names


async def test_tweak_mode_skips_intake():
    pipeline = GenerationPipeline(StubNodes(), max_code_retries=2)
    state = {**create_state(), "mode": "tweak", "tweak_instruction": "faster"}
    names = await run(pipeline, state)
    assert names[0] == "revise_blueprint"
    assert "understand" not in names


async def test_deep_review_runs_after_gate_pass():
    pipeline = GenerationPipeline(StubNodes(), max_code_retries=2, deep_review_enabled=True)
    names = await run(pipeline, create_state())
    assert "deep_review" in names
    assert names.index("deep_review") == names.index("validate") + 1


async def test_clarify_pauses_after_understand():
    pipeline = GenerationPipeline(
        StubNodes(questions=[SAMPLE_QUESTION]), max_code_retries=2, clarify_enabled=True
    )
    updates = {}

    async def collect():
        names = []
        async for name, update in pipeline.astream(create_state()):
            names.append(name)
            updates.update(update)
        return names

    names = await collect()
    assert names == ["understand", "await_input"]
    assert updates["questions"] == [SAMPLE_QUESTION]


async def test_clarify_resume_skips_intake():
    pipeline = GenerationPipeline(
        StubNodes(questions=[SAMPLE_QUESTION]), max_code_retries=2, clarify_enabled=True
    )
    state = {
        **create_state(),
        "resume": True,
        "answers": {"q_1": "opt_2"},
        "analysis": FakeAnalysis([SAMPLE_QUESTION]),
    }
    names = await run(pipeline, state)
    assert "understand" not in names
    assert names[0] == "blueprint"
    assert names[-2:] == ["package", "store"]


async def test_clarify_skip_flag_never_pauses():
    pipeline = GenerationPipeline(
        StubNodes(questions=[SAMPLE_QUESTION]), max_code_retries=2, clarify_enabled=True
    )
    names = await run(pipeline, {**create_state(), "skip_clarify": True})
    assert "await_input" not in names
    assert names[-2:] == ["package", "store"]


async def test_clarify_no_questions_never_pauses():
    pipeline = GenerationPipeline(StubNodes(), max_code_retries=2, clarify_enabled=True)
    names = await run(pipeline, create_state())
    assert "await_input" not in names
    assert names[-2:] == ["package", "store"]
