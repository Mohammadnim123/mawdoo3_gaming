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

    # Immutable-version targeting: where this build's bundle lands
    # (games/{id}/v{n}) and, for tweaks, where the current live bundle is
    # read from (art carry-over + previous-code context).
    target_prefix: str
    base_prefix: str

    # Clarifying-questions control. skip_clarify suppresses the pause
    # ("Surprise me" / API opt-out); resume=True re-enters the pipeline after
    # answers with the persisted analysis already in state (intake is never
    # re-run); answers maps question id -> chosen option id / free text.
    skip_clarify: bool
    resume: bool
    answers: dict[str, str]

    # Tweak-mode inputs (mode == JobKind.TWEAK rebuilds an existing game)
    mode: JobKind
    tweak_instruction: str
    base_blueprint: GameBlueprint
    # Optional normalized reference image (base64 WebP) attached to the tweak;
    # forwarded as an image content block on the tweak LLM calls. Absent for
    # create runs and image-less tweaks — the pipeline behaves exactly as
    # before when the key is missing.
    image_b64: str | None

    # Stage artifacts
    analysis: PromptAnalysis
    blueprint: GameBlueprint
    background_art: bytes | None  # painted bg.png (None → procedural backdrop)
    sprites: dict[str, bytes]  # painted transparent sprites {file_name: png}
    cover_art: bytes | None  # painted feed-card poster (None → bg copy / SVG)
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
    job_id: str,
    game_id: str,
    prompt: str,
    requested_locale: str | None,
    target_prefix: str = "",
    skip_clarify: bool = False,
) -> GenerationState:
    return GenerationState(
        job_id=job_id,
        game_id=game_id,
        prompt=prompt,
        requested_locale=requested_locale,
        mode=JobKind.CREATE,
        target_prefix=target_prefix,
        skip_clarify=skip_clarify,
        code_attempts=0,
    )


def tweak_state(
    job_id: str,
    game_id: str,
    instruction: str,
    base_blueprint: GameBlueprint,
    target_prefix: str = "",
    base_prefix: str = "",
) -> GenerationState:
    return GenerationState(
        job_id=job_id,
        game_id=game_id,
        prompt=instruction,
        requested_locale=base_blueprint.default_locale,
        mode=JobKind.TWEAK,
        tweak_instruction=instruction,
        base_blueprint=base_blueprint,
        target_prefix=target_prefix,
        base_prefix=base_prefix,
        code_attempts=0,
    )
