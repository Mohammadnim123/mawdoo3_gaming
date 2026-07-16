"""Drives one generation job through the pipeline and persists the outcome.

Reproducibility (C6): a successful game stores prompt + blueprint + template
version + model versions. Cost (C5): per-call token usage lands in the flat
llm_calls log during the run. Every exit path — success, gate failure,
timeout, crash, cancellation — leaves the job row in a terminal state, with
one deliberate exception: a pipeline paused on clarifying questions parks in
AWAITING_INPUT (no task alive) until answers resume it.

Versions are immutable: every successful build writes its bundle under
games/{id}/v{n} and records a GameVersion row; the Game's storage_prefix and
current_version_* pointers advance to the new build. Old builds stay playable
for the version tree and rollback.
"""

from __future__ import annotations

import asyncio
import logging

from generation_service.application.events import JobEventBus, JobEventEmitter
from generation_service.domain.entities import (
    FailureCode,
    Game,
    GameVersion,
    GenerationJob,
    JobKind,
    JobStatus,
    PipelineStage,
    game_version_prefix,
    new_id,
)
from generation_service.domain.ports import (
    GameRepository,
    GameVersionRepository,
    JobEventStore,
    JobRepository,
)
from generation_service.infrastructure.ai.pipeline import GenerationPipeline
from generation_service.infrastructure.ai.schemas import PromptAnalysis
from generation_service.infrastructure.ai.state import (
    GenerationState,
    initial_state,
    tweak_state,
)

logger = logging.getLogger(__name__)

INITIAL_VERSION_SUMMARY = "Initial version"

_NODE_STAGE: dict[str, PipelineStage] = {
    "understand": PipelineStage.UNDERSTANDING,
    "await_input": PipelineStage.CLARIFYING,
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
        versions: GameVersionRepository,
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
        self._versions = versions
        self._template_version = template_version
        self._blueprint_model = blueprint_model
        self._code_model = code_model
        self._timeout_seconds = timeout_seconds
        self._event_store = event_store
        self._event_bus = event_bus

    async def execute(self, job: GenerationJob, resume: bool = False) -> None:
        # CAS QUEUED -> RUNNING: a cancel landing between scheduling and this
        # task starting (e.g. right after answers resumed the job) wins here —
        # the run never starts and the terminal row is never overwritten.
        if not await self._jobs.mark_running(job.id):
            logger.info("job %s is no longer queued; skipping run", job.id)
            return

        # Resumed jobs continue the same event log — seed the seq counter from
        # what is already persisted so ids stay monotonic across the pause.
        start_seq = await self._event_store.last_seq(job.id) if resume else 0
        emitter = JobEventEmitter(job.id, self._event_store, self._event_bus, start_seq)

        base_game = None
        version_no = 1
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
            version_no = await self._versions.max_version_no(base_game.id) + 1
            state = tweak_state(
                job_id=job.id,
                game_id=base_game.id,
                instruction=job.prompt,
                base_blueprint=base_game.blueprint,
                target_prefix=game_version_prefix(base_game.id, version_no),
                base_prefix=base_game.storage_prefix,
            )
        else:
            game_id = new_id()
            state = initial_state(
                job_id=job.id,
                game_id=game_id,
                prompt=job.prompt,
                requested_locale=job.requested_locale,
                target_prefix=game_version_prefix(game_id, 1),
                skip_clarify=job.skip_clarify,
            )
            if resume:
                # Re-enter after clarifying answers: the persisted intake
                # analysis goes back into state so understand never re-runs.
                state["resume"] = True
                state["answers"] = dict(job.answers)
                if job.analysis_json:
                    try:
                        state["analysis"] = PromptAnalysis.model_validate_json(
                            job.analysis_json
                        )
                    except ValueError:
                        # Unparseable persisted analysis must not strand the
                        # job in RUNNING — re-run intake from scratch instead.
                        logger.warning(
                            "job %s resumed with invalid analysis; re-running intake", job.id
                        )
                        state["resume"] = False
                        state["skip_clarify"] = True

        accumulated: GenerationState = dict(state)  # type: ignore[assignment]
        last_step: str | None = None
        heal_attempts = 0

        if resume:
            # Make the resume visible immediately: the next pipeline yield is
            # tens of seconds away (the blueprint LLM call), and until an event
            # newer than 'questions' lands, a reloading client would replay the
            # log and re-render the already-answered clarify cards.
            last_step = "planning"
            await self._emit_safe(emitter, "step", {
                "step": "planning", "label": "Designing your game", "status": "running",
            })

        try:
            async with asyncio.timeout(self._timeout_seconds):
                async for node_name, update in self._pipeline.astream(state):
                    accumulated.update(update)
                    stage = _NODE_STAGE.get(node_name)
                    if stage is not None:
                        await self._jobs.set_stage(job.id, stage)
                    if node_name == "await_input":
                        await self._pause_for_answers(job, accumulated, emitter)
                        return
                    step = _NODE_STEP.get(node_name)
                    if step is not None and step[0] != last_step:
                        last_step = step[0]
                        await emitter.emit(
                            "step", {"step": step[0], "label": step[1], "status": "running"}
                        )
                    # Synthesized transcript: a failed gate that will retry is
                    # narrated as a heal round (Codply-style), so the creator
                    # sees "testing & fixing" instead of silence.
                    if node_name == "validate":
                        report = update.get("gate_report")
                        if report is not None and not report.passed:
                            heal_attempts += 1
                            first = report.failures[0].detail if report.failures else ""
                            await self._emit_safe(emitter, "heal", {
                                "attempt": heal_attempts,
                                "summary": first[:200] or "fixing a failed quality check",
                            })
            await self._persist_outcome(job, base_game, version_no, accumulated, emitter)
        except TimeoutError:
            await self._fail_unless_terminal(
                job.id,
                emitter,
                FailureCode.PIPELINE_TIMEOUT,
                f"generation exceeded {self._timeout_seconds}s",
                "This one took too long — please try again.",
            )
        except asyncio.CancelledError:
            # Service shutdown mid-run (or a creator cancel that already
            # marked the row): leave a terminal state (best effort) so the
            # client never polls a phantom 'running' job forever.
            try:
                await self._fail_unless_terminal(
                    job.id,
                    emitter,
                    FailureCode.INTERRUPTED,
                    "the service was restarted mid-generation — please submit again",
                    "The service restarted — please submit again.",
                )
            except Exception:  # noqa: BLE001 — the DB may already be closing
                logger.warning("could not persist interruption for job %s", job.id)
            raise
        except Exception as exc:
            logger.exception("pipeline crashed for job %s", job.id)
            await self._fail_unless_terminal(
                job.id,
                emitter,
                FailureCode.PIPELINE_ERROR,
                str(exc),
                "Something went wrong building this game.",
            )

    async def _pause_for_answers(
        self, job: GenerationJob, accumulated: GenerationState, emitter: JobEventEmitter
    ) -> None:
        """Park the job on its clarifying questions. Everything a resume needs
        is persisted (questions + analysis); the task ends here."""
        questions = accumulated.get("questions") or []
        analysis = accumulated.get("analysis")
        analysis_json = analysis.model_dump_json() if analysis is not None else "{}"
        await self._jobs.mark_awaiting_input(job.id, questions, analysis_json)
        await self._emit_safe(emitter, "questions", {
            "questions": [q.model_dump() for q in questions],
        })
        logger.info("job %s paused on %d clarifying question(s)", job.id, len(questions))

    async def _fail_unless_terminal(
        self,
        job_id: str,
        emitter: JobEventEmitter,
        code: FailureCode,
        message: str,
        user_message: str,
    ) -> None:
        """Mark the job failed unless something (a creator cancel) already
        finished it — a cancel's task teardown must not overwrite the row."""
        current = await self._jobs.get(job_id)
        if current is not None and current.status in (JobStatus.SUCCEEDED, JobStatus.FAILED):
            return
        await self._jobs.mark_failed(job_id, code, message)
        await self._emit_failed(emitter, code, user_message)

    async def _emit_safe(self, emitter: JobEventEmitter, event: str, data: dict) -> None:
        try:
            await emitter.emit(event, data)
        except Exception:  # noqa: BLE001 — progress events must never kill the run
            logger.warning("could not emit %s event", event)

    async def _emit_failed(self, emitter: JobEventEmitter, code, message: str) -> None:
        try:
            await emitter.emit("failed", {"error_code": _code_str(code), "error_user_msg": message})
        except Exception:  # noqa: BLE001 — never let event emission mask the failure
            logger.warning("could not emit failed event")

    async def _emit_done(
        self, emitter: JobEventEmitter, game_id: str, blueprint, version: GameVersion
    ) -> None:
        try:
            await emitter.emit("done", {
                "game_id": game_id,
                "title_en": blueprint.title.en,
                "title_ar": blueprint.title.ar,
                "version_id": version.id,
                "version_no": version.version_no,
            })
        except Exception:  # noqa: BLE001
            logger.warning("could not emit done event")

    async def _persist_outcome(
        self,
        job: GenerationJob,
        base_game: Game | None,
        version_no: int,
        accumulated: GenerationState,
        emitter: JobEventEmitter,
    ) -> None:
        """Persist success or gate failure. Runs inside the same error net as
        the pipeline: if persistence itself fails, the job is marked failed
        instead of being stranded in 'running'.

        Success is claimed with a CAS (RUNNING -> SUCCEEDED) BEFORE any
        product record is written: a creator cancel that landed during the
        final pipeline awaits keeps the row, and the outcome is discarded —
        the stored bundle bytes are orphaned, nothing is published."""
        gate_report = accumulated.get("gate_report")
        failure = accumulated.get("failure")
        if failure is not None:
            await self._fail_unless_terminal_with_report(
                job.id, emitter, failure.code, failure.message, gate_report
            )
            return

        blueprint = accumulated["blueprint"]
        stored_prefix = accumulated["stored_prefix"]
        published_game_id = base_game.id if base_game is not None else accumulated["game_id"]
        if not await self._jobs.mark_succeeded(job.id, published_game_id, gate_report):
            logger.info("job %s became terminal mid-run; discarding outcome", job.id)
            return

        if base_game is not None:
            # Tweak: the gate passed and a NEW immutable version was stored —
            # record it and advance the game's current pointers + metadata.
            version = GameVersion(
                id=new_id(),
                game_id=base_game.id,
                version_no=version_no,
                parent_id=base_game.current_version_id,
                job_id=job.id,
                change_summary=job.prompt,
                storage_prefix=stored_prefix,
                blueprint=blueprint,
            )
            await self._versions.add(version)
            base_game.apply_blueprint(blueprint)
            base_game.template_version = self._template_version
            base_game.blueprint_model = self._blueprint_model
            base_game.code_model = self._code_model
            base_game.storage_prefix = stored_prefix
            base_game.current_version_id = version.id
            base_game.current_version_no = version.version_no
            await self._games.update(base_game)
            await self._emit_done(emitter, base_game.id, blueprint, version)
            logger.info(
                "job %s tweaked game %s to v%d (%s)",
                job.id, base_game.id, version.version_no, job.prompt,
            )
            return

        version = GameVersion(
            id=new_id(),
            game_id=accumulated["game_id"],
            version_no=1,
            parent_id=None,
            job_id=job.id,
            change_summary=INITIAL_VERSION_SUMMARY,
            storage_prefix=stored_prefix,
            blueprint=blueprint,
        )
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
            storage_prefix=stored_prefix,
            current_version_id=version.id,
            current_version_no=1,
        )
        await self._games.add(game)
        await self._versions.add(version)
        await self._emit_done(emitter, game.id, blueprint, version)
        logger.info("job %s produced game %s (%s)", job.id, game.id, game.title_en)

    async def _fail_unless_terminal_with_report(
        self,
        job_id: str,
        emitter: JobEventEmitter,
        code,
        message: str,
        gate_report,
    ) -> None:
        current = await self._jobs.get(job_id)
        if current is not None and current.status in (JobStatus.SUCCEEDED, JobStatus.FAILED):
            return
        await self._jobs.mark_failed(job_id, code, message, gate_report)
        await self._emit_failed(emitter, code, message)
