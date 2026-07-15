"""Drives one generation job through the pipeline and persists the outcome.

Reproducibility (C6): a successful game stores prompt + blueprint + template
version + model versions. Cost (C5): per-call token usage lands in the flat
llm_calls log during the run. Every exit path — success, gate failure,
timeout, crash, cancellation — leaves the job row in a terminal state.
"""

from __future__ import annotations

import asyncio
import logging

from generation_service.domain.entities import (
    FailureCode,
    Game,
    GenerationJob,
    JobKind,
    JobStatus,
    PipelineStage,
    new_id,
)
from generation_service.domain.ports import GameRepository, JobRepository
from generation_service.infrastructure.ai.pipeline import GenerationPipeline
from generation_service.infrastructure.ai.state import (
    GenerationState,
    initial_state,
    tweak_state,
)

logger = logging.getLogger(__name__)

_NODE_STAGE: dict[str, PipelineStage] = {
    "understand": PipelineStage.UNDERSTANDING,
    "blueprint": PipelineStage.BLUEPRINT,
    "revise_blueprint": PipelineStage.BLUEPRINT,
    "generate_code": PipelineStage.CODE_GENERATION,
    "validate": PipelineStage.VALIDATION,
    "deep_review": PipelineStage.VALIDATION,
    "salvage": PipelineStage.VALIDATION,
    "package": PipelineStage.PACKAGING,
    "store": PipelineStage.STORAGE,
}


class RunGenerationUseCase:
    def __init__(
        self,
        pipeline: GenerationPipeline,
        jobs: JobRepository,
        games: GameRepository,
        template_version: str,
        blueprint_model: str,
        code_model: str,
        timeout_seconds: float,
    ) -> None:
        self._pipeline = pipeline
        self._jobs = jobs
        self._games = games
        self._template_version = template_version
        self._blueprint_model = blueprint_model
        self._code_model = code_model
        self._timeout_seconds = timeout_seconds

    async def execute(self, job: GenerationJob) -> None:
        await self._jobs.set_status(job.id, JobStatus.RUNNING)

        base_game = None
        if job.kind == JobKind.TWEAK:
            base_game = await self._games.get(job.game_id or "")
            if base_game is None:
                await self._jobs.mark_failed(
                    job.id,
                    FailureCode.GAME_NOT_FOUND,
                    f"game {job.game_id!r} no longer exists",
                )
                return
            state = tweak_state(
                job_id=job.id,
                game_id=base_game.id,
                instruction=job.prompt,
                base_blueprint=base_game.blueprint,
            )
        else:
            state = initial_state(
                job_id=job.id,
                game_id=new_id(),
                prompt=job.prompt,
                requested_locale=job.requested_locale,
            )
        accumulated: GenerationState = dict(state)  # type: ignore[assignment]

        try:
            async with asyncio.timeout(self._timeout_seconds):
                async for node_name, update in self._pipeline.astream(state):
                    accumulated.update(update)
                    stage = _NODE_STAGE.get(node_name)
                    if stage is not None:
                        await self._jobs.set_stage(job.id, stage)
            await self._persist_outcome(job, base_game, accumulated)
        except TimeoutError:
            await self._jobs.mark_failed(
                job.id,
                FailureCode.PIPELINE_TIMEOUT,
                f"generation exceeded {self._timeout_seconds}s",
            )
        except asyncio.CancelledError:
            # Service shutdown mid-run: leave a terminal state (best effort)
            # so the client never polls a phantom 'running' job forever.
            try:
                await self._jobs.mark_failed(
                    job.id,
                    FailureCode.INTERRUPTED,
                    "the service was restarted mid-generation — please submit again",
                )
            except Exception:  # noqa: BLE001 — the DB may already be closing
                logger.warning("could not persist interruption for job %s", job.id)
            raise
        except Exception as exc:
            logger.exception("pipeline crashed for job %s", job.id)
            await self._jobs.mark_failed(job.id, FailureCode.PIPELINE_ERROR, str(exc))

    async def _persist_outcome(
        self, job: GenerationJob, base_game: Game | None, accumulated: GenerationState
    ) -> None:
        """Persist success or gate failure. Runs inside the same error net as
        the pipeline: if persistence itself fails, the job is marked failed
        instead of being stranded in 'running'."""
        gate_report = accumulated.get("gate_report")
        failure = accumulated.get("failure")
        if failure is not None:
            await self._jobs.mark_failed(job.id, failure.code, failure.message, gate_report)
            return

        blueprint = accumulated["blueprint"]
        if base_game is not None:
            # Tweak: the gate passed and the bundle was replaced —
            # bring the metadata in line so blueprint always matches the live game.
            base_game.apply_blueprint(blueprint)
            base_game.template_version = self._template_version
            base_game.blueprint_model = self._blueprint_model
            base_game.code_model = self._code_model
            await self._games.update(base_game)
            await self._jobs.mark_succeeded(job.id, base_game.id, gate_report)
            logger.info("job %s tweaked game %s (%s)", job.id, base_game.id, job.prompt)
            return

        game = Game(
            id=accumulated["game_id"],
            title_en=blueprint.title.en,
            title_ar=blueprint.title.ar,
            genre=blueprint.genre.value,
            summary=blueprint.summary,
            default_locale=blueprint.default_locale,
            prompt=job.prompt,
            blueprint=blueprint,
            template_version=self._template_version,
            blueprint_model=self._blueprint_model,
            code_model=self._code_model,
            storage_prefix=accumulated["stored_prefix"],
        )
        await self._games.add(game)
        await self._jobs.mark_succeeded(job.id, game.id, gate_report)
        logger.info("job %s produced game %s (%s)", job.id, game.id, game.title_en)
