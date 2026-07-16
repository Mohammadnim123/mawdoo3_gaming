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
from collections.abc import Callable

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
    JobDraftStore,
    JobEventStore,
    JobRepository,
    StoragePort,
)
from generation_service.infrastructure.ai.pipeline import GenerationPipeline
from generation_service.infrastructure.ai.schemas import PromptAnalysis
from generation_service.infrastructure.ai.state import (
    GenerationState,
    initial_state,
    tweak_state,
)
from generation_service.infrastructure.packaging.cover import write_cover

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
        terminal_lock: asyncio.Lock | None = None,
        drafts: JobDraftStore | None = None,
        storage: StoragePort | None = None,
        bundle_url: Callable[[str, str], str] | None = None,
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
        # Serializes every terminal decision (success persist, failure mark,
        # creator cancel) — jobs run in-process by design, so one lock makes
        # check-then-act transitions atomic. Shared with CancelGeneration; the
        # seam moves into DB transactions if jobs ever leave this process.
        self._terminal_lock = terminal_lock or asyncio.Lock()
        # Additive hooks around the pipeline (all optional so the run works
        # unchanged without them): live draft snapshots, best-effort cover
        # writing, and absolute bundle-file URLs (prefix, rel_path) -> URL.
        self._drafts = drafts
        self._storage = storage
        self._bundle_url = bundle_url

    async def execute(
        self, job: GenerationJob, resume: bool = False, image_b64: str | None = None
    ) -> None:
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
                await self._fail_unless_terminal(
                    job.id,
                    emitter,
                    FailureCode.GAME_NOT_FOUND,
                    f"game {job.game_id!r} no longer exists",
                    "That game no longer exists.",
                )
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
            if image_b64:
                # Normalized reference image riding along with the tweak; the
                # LLM adapter attaches it to the tweak-related generations.
                state["image_b64"] = image_b64
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
        last_step_label: str = ""
        heal_attempts = 0

        if resume:
            # Make the resume visible immediately: the next pipeline yield is
            # tens of seconds away (the blueprint LLM call), and until an event
            # newer than 'questions' lands, a reloading client would replay the
            # log and re-render the already-answered clarify cards.
            last_step = "planning"
            last_step_label = "Designing your game"
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
                        # A new step starting completes the previous one — the
                        # step timeline needs explicit terminal frames (the
                        # contract client normalizes completed→done).
                        if last_step is not None:
                            await self._emit_safe(emitter, "step", {
                                "step": last_step, "label": last_step_label,
                                "status": "completed",
                            })
                        last_step, last_step_label = step[0], step[1]
                        await emitter.emit(
                            "step", {"step": step[0], "label": step[1], "status": "running"}
                        )
                    # Post-codegen hooks (additive, never fatal): `file` SSE
                    # events for the produced files + a live draft snapshot,
                    # then a richer draft (with index.html) once packaged.
                    if node_name == "generate_code":
                        await self._after_codegen(job, accumulated, emitter)
                    elif node_name == "package":
                        await self._save_bundle_draft(job, accumulated)
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
            if last_step is not None:
                await self._emit_safe(emitter, "step", {
                    "step": last_step, "label": last_step_label, "status": "completed",
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
        is persisted (questions + analysis); the task ends here. The CAS
        (RUNNING -> AWAITING_INPUT) loses to a creator cancel that landed
        during intake — a cancelled job must never come back as answerable."""
        questions = accumulated.get("questions") or []
        analysis = accumulated.get("analysis")
        analysis_json = analysis.model_dump_json() if analysis is not None else "{}"
        if not await self._jobs.mark_awaiting_input(job.id, questions, analysis_json):
            logger.info("job %s went terminal during intake; abandoning the pause", job.id)
            return
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
        finished it — a cancel's task teardown must not overwrite the row.
        Runs under the terminal lock so the check and the mark are atomic
        against a concurrent cancel/success."""
        async with self._terminal_lock:
            current = await self._jobs.get(job_id)
            if current is not None and current.status in (
                JobStatus.SUCCEEDED, JobStatus.FAILED,
            ):
                return
            await self._jobs.mark_failed(job_id, code, message)
            await self._emit_failed(emitter, code, user_message)

    async def _emit_safe(self, emitter: JobEventEmitter, event: str, data: dict) -> None:
        try:
            await emitter.emit(event, data)
        except Exception:  # noqa: BLE001 — progress events must never kill the run
            logger.warning("could not emit %s event", event)

    async def _after_codegen(
        self, job: GenerationJob, accumulated: GenerationState, emitter: JobEventEmitter
    ) -> None:
        """Codegen finished: emit one `file` event per produced file (Codply
        FileEventData: {path, action, bytes}) and snapshot the live draft.
        Best-effort — cosmetic hooks never kill the run."""
        code = accumulated.get("code")
        if code is None:
            return
        action = "updated" if job.kind == JobKind.TWEAK else "created"
        files = [("game.js", code.game_js)]
        if code.game_css:
            files.append(("game.css", code.game_css))
        for path, content in files:
            await self._emit_safe(emitter, "file", {
                "path": path, "action": action, "bytes": len(content.encode()),
            })
        await self._save_draft(job.id, {
            "content": None,
            "files": [{"path": path, "content": content} for path, content in files],
        })

    async def _save_bundle_draft(self, job: GenerationJob, accumulated: GenerationState) -> None:
        """Packaging finished: refresh the draft with the assembled bundle's
        human-readable files, index.html first (Codply JobDraft semantics)."""
        bundle = accumulated.get("bundle_files")
        if not bundle:
            return
        index_text: str | None = None
        files: list[dict] = []
        for name in ("index.html", "game.js", "game.css"):
            data = bundle.get(name)
            if data is None:
                continue
            text = data.decode("utf-8", errors="replace")
            files.append({"path": name, "content": text})
            if name == "index.html":
                index_text = text
        if files:
            await self._save_draft(job.id, {"content": index_text, "files": files})

    async def _save_draft(self, job_id: str, draft: dict) -> None:
        if self._drafts is None:
            return
        try:
            await self._drafts.save(job_id, draft)
        except Exception:  # noqa: BLE001 — the draft is cosmetic, never fatal
            logger.warning("could not persist draft for job %s", job_id)

    async def _write_cover(self, accumulated: GenerationState) -> str | None:
        """Best-effort cover next to the stored bundle: cover.png (a copy of
        the painted bg.png) or a procedural cover.svg. Never blocks or fails
        the publish — any error just means no cover."""
        if self._storage is None:
            return None
        bundle = accumulated.get("bundle_files")
        prefix = accumulated.get("stored_prefix")
        blueprint = accumulated.get("blueprint")
        if not bundle or not prefix or blueprint is None:
            return None
        try:
            return await write_cover(self._storage, prefix, bundle, blueprint)
        except Exception:  # noqa: BLE001 — covers are cosmetic by contract
            logger.warning("could not write cover for %s", accumulated.get("game_id"))
            return None

    def _cover_url(self, prefix: str | None, cover_file: str | None) -> str | None:
        if not prefix or not cover_file or self._bundle_url is None:
            return None
        return self._bundle_url(prefix, cover_file)

    async def _emit_failed(self, emitter: JobEventEmitter, code, message: str) -> None:
        try:
            await emitter.emit("failed", {"error_code": _code_str(code), "error_user_msg": message})
        except Exception:  # noqa: BLE001 — never let event emission mask the failure
            logger.warning("could not emit failed event")

    async def _emit_done(
        self,
        emitter: JobEventEmitter,
        game_id: str,
        blueprint,
        version: GameVersion,
        cover_url: str | None = None,
    ) -> None:
        try:
            await emitter.emit("done", {
                "game_id": game_id,
                "title_en": blueprint.title.en,
                "title_ar": blueprint.title.ar,
                "version_id": version.id,
                "version_no": version.version_no,
                "cover_url": cover_url,
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

        The whole terminal decision runs under the shared terminal lock, so
        a creator cancel can never interleave: either it committed first (the
        status check discards this outcome — bundle bytes are orphaned,
        nothing published) or it waits and then conflicts on the terminal row.
        Product records are written BEFORE the status flips to SUCCEEDED —
        the job keeps holding its game's one-active-job slot until the version
        row + pointers are durable, and a crash mid-write leaves a RUNNING row
        for the restart sweep instead of a wedged SUCCEEDED-without-records."""
        async with self._terminal_lock:
            current = await self._jobs.get(job.id)
            if current is not None and current.status in (
                JobStatus.SUCCEEDED, JobStatus.FAILED,
            ):
                logger.info(
                    "job %s became terminal (%s) mid-run; discarding outcome",
                    job.id, current.status,
                )
                return

            gate_report = accumulated.get("gate_report")
            failure = accumulated.get("failure")
            if failure is not None:
                await self._jobs.mark_failed(job.id, failure.code, failure.message, gate_report)
                await self._emit_failed(emitter, failure.code, failure.message)
                return

            blueprint = accumulated["blueprint"]
            stored_prefix = accumulated["stored_prefix"]

            # Best-effort cover (bg.png copy or procedural SVG) next to the
            # bundle; recorded on the game row and surfaced in `done`.
            cover_file = await self._write_cover(accumulated)
            cover_url = self._cover_url(stored_prefix, cover_file)

            if base_game is not None:
                # Tweak: the gate passed and a NEW immutable version was
                # stored — record it and advance the game's current pointers.
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
                base_game.cover_file = cover_file
                await self._games.update(base_game)
                await self._jobs.mark_succeeded(job.id, base_game.id, gate_report)
                await self._emit_done(emitter, base_game.id, blueprint, version, cover_url)
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
                cover_file=cover_file,
            )
            await self._games.add(game)
            await self._versions.add(version)
            await self._jobs.mark_succeeded(job.id, game.id, gate_report)
            await self._emit_done(emitter, game.id, blueprint, version, cover_url)
            logger.info("job %s produced game %s (%s)", job.id, game.id, game.title_en)
