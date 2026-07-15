"""LangGraph state for one generation run."""

from __future__ import annotations

from typing import TypedDict

from generation_service.domain.blueprint import GameBlueprint
from generation_service.domain.entities import (
    GateReport,
    GeneratedGameCode,
    JobKind,
    PipelineFailure,
)
from generation_service.infrastructure.ai.schemas import PromptAnalysis


class GenerationState(TypedDict, total=False):
    # Inputs
    job_id: str
    game_id: str
    prompt: str
    requested_locale: str | None

    # Tweak-mode inputs (mode == JobKind.TWEAK rebuilds an existing game)
    mode: JobKind
    tweak_instruction: str
    base_blueprint: GameBlueprint

    # Stage artifacts
    analysis: PromptAnalysis
    blueprint: GameBlueprint
    code: GeneratedGameCode
    gate_report: GateReport
    bundle_files: dict[str, bytes]
    stored_prefix: str

    # Best shippable attempt so far (no blocking gate failures) — what gets
    # published if retries run out before a fully clean attempt appears.
    best_code: GeneratedGameCode
    best_report: GateReport

    # Control
    code_attempts: int
    failure: PipelineFailure


def initial_state(
    job_id: str, game_id: str, prompt: str, requested_locale: str | None
) -> GenerationState:
    return GenerationState(
        job_id=job_id,
        game_id=game_id,
        prompt=prompt,
        requested_locale=requested_locale,
        mode=JobKind.CREATE,
        code_attempts=0,
    )


def tweak_state(
    job_id: str,
    game_id: str,
    instruction: str,
    base_blueprint: GameBlueprint,
) -> GenerationState:
    return GenerationState(
        job_id=job_id,
        game_id=game_id,
        prompt=instruction,
        requested_locale=base_blueprint.default_locale,
        mode=JobKind.TWEAK,
        tweak_instruction=instruction,
        base_blueprint=base_blueprint,
        code_attempts=0,
    )
