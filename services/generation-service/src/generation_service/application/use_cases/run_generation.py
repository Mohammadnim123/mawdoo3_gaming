"""Drives one generation job through the pipeline and persists the outcome.

Reproducibility (C6): a successful game stores prompt + blueprint + template
version + model versions. Cost (C5): per-call token usage lands in the flat
llm_calls log during the run. Every exit path — success, gate failure,
timeout, crash, cancellation — leaves the job row in a terminal state.
"""

from __future__ import annotations

import asyncio
import logging

from generation_service.application.events import JobEventBus, JobEventEmitter
from generation_service.domain.entities import (
    FailureCode,
    Game,
    GenerationJob,
    JobKind,
    JobStatus,
    PipelineStage,
    new_id,
)
from generation_service.domain.ports import GameRepository, JobEventStore, JobRepository
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
    "paint_background": PipelineStage.BLUEPRINT,
    "generate_code": PipelineStage.CODE_GENERATION,
    "validate": PipelineStage.VALIDATION,
    "deep_review": PipelineStage.VALIDATION,
    "salvage": PipelineStage.VALIDATION,
    "package": PipelineStage.PACKAGING,
    "store": PipelineStage.STORAGE,
}

# Node -> (Codply-style step name, friendly label) for the SSE StepTimeline.
_NODE_STEP: dict[str, tuple[str, str]] = {
    "understand": ("enhancing", "Understanding your idea"),
    "blueprint": ("planning", "Designing your game"),
    "revise_blueprint": ("planning", "Updating your game"),
    "paint_background": ("assets", "Drawing art & sound"),
    "generate_code": ("codegen", "Building your game"),
    "validate": ("qa", "Testing & fixing"),
    "deep_review": ("qa", "Testing & fixing"),
    "salvage": ("qa", "Testing & fixing"),
    "package": ("publishing", "Publishing"),
    "store": ("publishing", "Publishing"),
}


def _code_str(code) -> str:
    return str(getattr(code, "value", code))


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
        event_store: JobEventStore,
        event_bus: JobEventBus,
    ) -> None:
        self._pipeline = pipeline
        self._jobs = jobs
        self._games = games
        self._template_version = template_version
        self._blueprint_model = blueprint_model
        self._code_model = code_model
        self._timeout_seconds = timeout_seconds
        self._event_store = event_store
        self._event_bus = event_bus

    async def execute(self, job: GenerationJob) -> None:
        emitter = JobEventEmitter(job.id, self._event_store, self._event_bus)
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
                await self._emit_failed(emitter, FailureCode.GAME_NOT_FOUND,
                                        "That game no longer exists.")
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
        last_step: str | None = None

        try:
            async with asyncio.timeout(self._timeout_seconds):
                async for node_name, update in self._pipeline.astream(state):
                    accumulated.update(update)
                    stage = _NODE_STAGE.get(node_name)
                    if stage is not None:
                        await self._jobs.set_stage(job.id, stage)
                    step = _NODE_STEP.get(node_name)
                    if step is not None and step[0] != last_step:
                        last_step = step[0]
                        await emitter.emit(
                            "step", {"step": step[0], "label": step[1], "status": "running"}
                        )
            await self._persist_outcome(job, base_game, accumulated, emitter)
        except TimeoutError:
            await self._jobs.mark_failed(
                job.id,
                FailureCode.PIPELINE_TIMEOUT,
                f"generation exceeded {self._timeout_seconds}s",
            )
            await self._emit_failed(emitter, FailureCode.PIPELINE_TIMEOUT,
                                    "This one took too long — please try again.")
        except asyncio.CancelledError:
            # Service shutdown mid-run: leave a terminal state (best effort)
            # so the client never polls a phantom 'running' job forever.
            try:
                await self._jobs.mark_failed(
                    job.id,
                    FailureCode.INTERRUPTED,
                    "the service was restarted mid-generation — please submit again",
                )
                await self._emit_failed(emitter, FailureCode.INTERRUPTED,
                                        "The service restarted — please submit again.")
            except Exception:  # noqa: BLE001 — the DB may already be closing
                logger.warning("could not persist interruption for job %s", job.id)
            raise
        except Exception as exc:
            logger.exception("pipeline crashed for job %s", job.id)
            await self._jobs.mark_failed(job.id, FailureCode.PIPELINE_ERROR, str(exc))
            await self._emit_failed(emitter, FailureCode.PIPELINE_ERROR,
                                    "Something went wrong building this game.")

    async def _emit_failed(self, emitter: JobEventEmitter, code, message: str) -> None:
        try:
            await emitter.emit("failed", {"error_code": _code_str(code), "error_user_msg": message})
        except Exception:  # noqa: BLE001 — never let event emission mask the failure
            logger.warning("could not emit failed event")

    async def _emit_done(self, emitter: JobEventEmitter, game_id: str, blueprint) -> None:
        try:
            await emitter.emit("done", {
                "game_id": game_id,
                "title_en": blueprint.title.en,
                "title_ar": blueprint.title.ar,
            })
        except Exception:  # noqa: BLE001
            logger.warning("could not emit done event")

    async def _persist_outcome(
        self,
        job: GenerationJob,
        base_game: Game | None,
        accumulated: GenerationState,
        emitter: JobEventEmitter,
    ) -> None:
        """Persist success or gate failure. Runs inside the same error net as
        the pipeline: if persistence itself fails, the job is marked failed
        instead of being stranded in 'running'."""
        gate_report = accumulated.get("gate_report")
        failure = accumulated.get("failure")
        if failure is not None:
            await self._jobs.mark_failed(job.id, failure.code, failure.message, gate_report)
            await self._emit_failed(emitter, failure.code, failure.message)
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
            await self._emit_done(emitter, base_game.id, blueprint)
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
        await self._emit_done(emitter, game.id, blueprint)
        logger.info("job %s produced game %s (%s)", job.id, game.id, game.title_en)
