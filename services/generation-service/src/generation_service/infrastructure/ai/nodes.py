"""Pipeline nodes.

Each node is a small async function over GenerationState with its
dependencies injected. Agent 1 (the designer) owns understand / blueprint /
revise; Agent 2 (the implementer) owns code generation. Every LLM call is a
schema-validated Anthropic SDK call recorded in the flat llm_calls log
(cost tracking from day one).
"""

from __future__ import annotations

import asyncio
import logging

from generation_service.domain.blueprint import GameBlueprint
from generation_service.domain.entities import (
    FailureCode,
    GateCheck,
    GateReport,
    GeneratedGameCode,
    JobKind,
    PipelineFailure,
    PipelineStage,
    game_storage_prefix,
)
from generation_service.domain.ports import LlmCallLog, StoragePort
from generation_service.infrastructure.ai.llm import StructuredLlm
from generation_service.infrastructure.ai.prompts import (
    BACKGROUND_ART_SECTION,
    PREVIOUS_CODE_TEMPLATE,
    RETRY_FEEDBACK_TEMPLATE,
    build_blueprint,
    build_code,
    build_review,
    build_revise_blueprint,
    build_sprites_section,
    build_understand,
)
from generation_service.infrastructure.ai.schemas import PromptAnalysis, ReviewVerdict
from generation_service.infrastructure.ai.state import GenerationState
from generation_service.infrastructure.art import ChromaCutout, GeminiArtClient
from generation_service.infrastructure.packaging.assembler import (
    OPTIONAL_ART_FILE,
    TemplateAssembler,
    sprite_file_name,
)
from generation_service.infrastructure.storage import store_bundle
from generation_service.infrastructure.validation.gate import QualityGate

logger = logging.getLogger(__name__)


class GenerationNodes:
    def __init__(
        self,
        understanding_llm: StructuredLlm,
        blueprint_llm: StructuredLlm,
        code_llm: StructuredLlm,
        gate: QualityGate,
        assembler: TemplateAssembler,
        storage: StoragePort,
        llm_log: LlmCallLog,
        art: GeminiArtClient | None = None,
    ) -> None:
        self._understanding_llm = understanding_llm
        self._blueprint_llm = blueprint_llm
        self._code_llm = code_llm
        self._gate = gate
        self._assembler = assembler
        self._storage = storage
        self._llm_log = llm_log
        self._art = art
        self._cutout = ChromaCutout()

    # ------------------------------------------------------------------ #
    # 1. Prompt understanding (scope check + normalization)
    # ------------------------------------------------------------------ #

    async def understand(self, state: GenerationState) -> dict:
        # The web client runs its own lighter pre-dispatch validation; this
        # stage is the service's authoritative scope check — prompts dispatched
        # straight against the API get exactly the same treatment.
        system, user = build_understand(state["prompt"])
        analysis, usage = await self._understanding_llm.generate(
            "understanding", system, user, PromptAnalysis
        )
        await self._llm_log.record(state["job_id"], usage)
        if not analysis.in_scope:
            return {
                "analysis": analysis,
                "failure": PipelineFailure(
                    stage=PipelineStage.UNDERSTANDING,
                    code=FailureCode.OUT_OF_SCOPE,
                    message=analysis.rejection_reason
                    or "This idea is outside the mini-game scope of the MVP.",
                ),
            }
        return {"analysis": analysis}

    # ------------------------------------------------------------------ #
    # 2. Blueprint (AI#1 — the internal design artifact)
    # ------------------------------------------------------------------ #

    async def design_blueprint(self, state: GenerationState) -> dict:
        analysis = state["analysis"]
        locale_hint = state.get("requested_locale") or (
            "ar" if analysis.detected_language in ("ar", "mixed") else "en"
        )
        system, user = build_blueprint(
            state["prompt"],
            analysis.game_concept,
            locale_hint,
            clarifications=self._clarifications_text(state),
        )
        blueprint, usage = await self._blueprint_llm.generate(
            "blueprint", system, user, GameBlueprint
        )
        await self._llm_log.record(state["job_id"], usage)
        return {"blueprint": blueprint}

    @staticmethod
    def _clarifications_text(state: GenerationState) -> str:
        """Q/A lines for the design prompt. Unanswered questions fall back to
        their default option — 'Surprise me' is just an empty answers dict."""
        analysis = state.get("analysis")
        if analysis is None:
            return ""
        questions = analysis.domain_questions()
        if not questions:
            return ""
        answers = state.get("answers") or {}
        lines = []
        for question in questions:
            chosen = answers.get(question.id, "").strip()
            labels = {option.id: option.label for option in question.options}
            answer = labels.get(chosen) or chosen or labels.get(question.default_option_id, "")
            if answer:
                lines.append(f"Q: {question.question}\nA: {answer}")
        return "\n".join(lines)

    # ------------------------------------------------------------------ #
    # 2b. Blueprint revision (tweak mode — chat edits on an existing game)
    # ------------------------------------------------------------------ #

    async def revise_blueprint(self, state: GenerationState) -> dict:
        system, user = build_revise_blueprint(
            state["base_blueprint"].model_dump_json(indent=2),
            state["tweak_instruction"],
        )
        blueprint, usage = await self._blueprint_llm.generate(
            "blueprint_revision", system, user, GameBlueprint
        )
        await self._llm_log.record(state["job_id"], usage)
        return {"blueprint": blueprint}

    # ------------------------------------------------------------------ #
    # 2c. Background painting (optional — the "painted world" quality lever)
    # ------------------------------------------------------------------ #

    async def paint_background(self, state: GenerationState) -> dict:
        """Paint the blueprint's world backdrop (bg.png) and hero sprites
        (sprite_<name>.png, transparent via chroma cutout) — concurrently.

        Progressive enhancement, never a blocker: any failure (no client, no
        brief, provider error) degrades that asset away and the code prompt's
        procedural rendering takes over. Tweaks reuse the existing art so the
        game's look stays stable across chat edits.
        """
        blueprint = state["blueprint"]
        if state.get("mode") == JobKind.TWEAK:
            return await self._carry_over_art(state, blueprint)
        if self._art is None:
            return {"background_art": None, "sprites": {}}

        async def paint_bg() -> bytes | None:
            brief = (blueprint.background_art_prompt or "").strip()
            if not brief:
                return None
            return await self._art.paint_background(brief)

        async def paint_sprite(name: str, brief: str) -> tuple[str, bytes]:
            raw = await self._art.paint_sprite(brief)
            cut = await asyncio.to_thread(self._cutout.cut, raw, target_size=(192, 192))
            return sprite_file_name(name), cut

        briefs = [
            (b.name, b.prompt.strip()) for b in blueprint.sprite_briefs[:3] if b.prompt.strip()
        ]
        results = await asyncio.gather(
            paint_bg(),
            *(paint_sprite(name, brief) for name, brief in briefs),
            return_exceptions=True,
        )
        background = results[0]
        if isinstance(background, BaseException):
            logger.warning("background painting failed for %s: %s", state["game_id"], background)
            background = None
        sprites: dict[str, bytes] = {}
        for outcome in results[1:]:
            if isinstance(outcome, BaseException):
                logger.warning("sprite painting failed for %s: %s", state["game_id"], outcome)
                continue
            file_name, data = outcome
            sprites[file_name] = data
        logger.info(
            "art for %s: backdrop=%s, sprites=%s",
            state["game_id"],
            "yes" if background else "no",
            sorted(sprites) or "none",
        )
        return {"background_art": background, "sprites": sprites}

    async def _carry_over_art(self, state: GenerationState, blueprint: GameBlueprint) -> dict:
        """Tweak mode: reuse the current version's art files unchanged."""
        prefix = state.get("base_prefix") or game_storage_prefix(state["game_id"])

        async def fetch(rel_path: str) -> bytes | None:
            try:
                return await self._storage.get(f"{prefix}/{rel_path}")
            except Exception:  # noqa: BLE001 — absent art is the normal case
                return None

        background = await fetch(OPTIONAL_ART_FILE)
        sprites: dict[str, bytes] = {}
        for brief in blueprint.sprite_briefs[:3]:
            file_name = sprite_file_name(brief.name)
            data = await fetch(file_name)
            if data is not None:
                sprites[file_name] = data
        return {"background_art": background, "sprites": sprites}

    # ------------------------------------------------------------------ #
    # 3. Code generation (AI#2 — bespoke gameplay on the template contract)
    # ------------------------------------------------------------------ #

    async def generate_code(self, state: GenerationState) -> dict:
        attempts = state.get("code_attempts", 0)
        gate_report = state.get("gate_report")
        feedback = ""
        if attempts and gate_report and not gate_report.passed:
            feedback = RETRY_FEEDBACK_TEMPLATE.format(failures=gate_report.feedback())
        previous_section = await self._previous_code_section(state)
        art_section = (BACKGROUND_ART_SECTION if state.get("background_art") else "") + (
            build_sprites_section(sorted(state.get("sprites") or {}))
        )
        system, user = build_code(
            self._assembler.contract_doc,
            state["blueprint"].model_dump_json(indent=2),
            previous_section,
            feedback,
            art_section,
        )
        code, usage = await self._code_llm.generate(
            "code_generation", system, user, GeneratedGameCode
        )
        await self._llm_log.record(state["job_id"], usage)
        return {"code": code, "code_attempts": attempts + 1}

    async def _previous_code_section(self, state: GenerationState) -> str:
        """Tweak mode: give the model the current implementation so edits stay minimal."""
        if state.get("mode") != JobKind.TWEAK:
            return ""
        prefix = state.get("base_prefix") or game_storage_prefix(state["game_id"])
        try:
            game_js = (await self._storage.get(f"{prefix}/game.js")).decode()
            game_css = (await self._storage.get(f"{prefix}/game.css")).decode()
        except Exception:
            logger.warning("previous code unavailable for tweak of %s", state["game_id"])
            return ""
        return PREVIOUS_CODE_TEMPLATE.format(
            game_js=game_js, game_css=game_css, instruction=state["tweak_instruction"]
        )

    # ------------------------------------------------------------------ #
    # 4. Validation — the blocking quality gate
    # ------------------------------------------------------------------ #

    async def validate(self, state: GenerationState) -> dict:
        report = await self._gate.run(state["blueprint"], state["code"])
        update: dict = {"gate_report": report}
        if not report.passed:
            logger.info(
                "gate rejected game %s (attempt %s): %s",
                state["game_id"],
                state.get("code_attempts"),
                [c.check_id for c in report.failures],
            )
            await self._store_rejected_attempt(state, report)
        # Remember the best shippable attempt (safe + runnable, fewest
        # failures; ties go to the newest — it incorporated the most feedback).
        # If retries run out, this is what gets published instead of an error.
        best = state.get("best_report")
        if report.shippable and (best is None or len(report.failures) <= len(best.failures)):
            update["best_code"] = state["code"]
            update["best_report"] = report
        return update

    async def _store_rejected_attempt(self, state: GenerationState, report) -> None:
        """Keep rejected code inspectable (debug/{game_id}/attempt-N.*) —
        without it a repeated gate failure cannot be diagnosed at all."""
        prefix = f"debug/{state['game_id']}/attempt-{state.get('code_attempts', 0)}"
        code = state["code"]
        try:
            await self._storage.put(f"{prefix}.game.js", code.game_js.encode(), "text/javascript")
            if code.game_css:
                await self._storage.put(f"{prefix}.game.css", code.game_css.encode(), "text/css")
            report_text = report.feedback().encode()
            await self._storage.put(f"{prefix}.report.txt", report_text, "text/plain")
        except Exception:  # noqa: BLE001 — debug artifacts must never fail the pipeline
            logger.warning("could not store rejected attempt for %s", state["game_id"])

    # ------------------------------------------------------------------ #
    # 4b. Deep logic review (gate stage 2 — FEATURE_LLM_REVIEW)
    # ------------------------------------------------------------------ #

    async def deep_review(self, state: GenerationState) -> dict:
        system, user = build_review(
            state["blueprint"].model_dump_json(indent=2), state["code"].game_js
        )
        verdict, usage = await self._blueprint_llm.generate(
            "deep_review", system, user, ReviewVerdict
        )
        await self._llm_log.record(state["job_id"], usage)

        review_checks = [
            GateCheck(
                check_id="review.logic",
                passed=False,
                detail=f"{issue.rule}: {issue.problem} — fix: {issue.fix_hint}",
            )
            for issue in verdict.issues
        ]
        if not review_checks:
            if verdict.passed:
                review_checks = [GateCheck(check_id="review.logic", passed=True)]
            else:
                # A failing verdict with no itemized issues must still produce
                # actionable feedback, or retries get an empty failure list.
                review_checks = [
                    GateCheck(
                        check_id="review.logic",
                        passed=False,
                        detail=(
                            "the deep review rejected the game without naming issues — "
                            "re-read the blueprint and implement its core_rule and every "
                            "rule exactly as specified"
                        ),
                    )
                ]
        if not verdict.passed:
            logger.info(
                "deep review rejected game %s (attempt %s): %d issue(s)",
                state["game_id"],
                state.get("code_attempts"),
                len(verdict.issues),
            )
        prior = state["gate_report"]
        merged = GateReport(
            passed=prior.passed and verdict.passed,
            checks=[*prior.checks, *review_checks],
        )
        update: dict = {"gate_report": merged}
        if state.get("best_code") is state["code"]:
            # Keep the tracked best attempt's report complete: review findings
            # are advisory, but they belong in the published job record.
            update["best_report"] = merged
        return update

    async def salvage_best_effort(self, state: GenerationState) -> dict:
        """Retries are exhausted. Publish the best safe-and-runnable attempt
        instead of surfacing a generation error — the gate's job is to raise
        quality through retries, not to take the game away from the creator.
        Only when every attempt was unsafe or unrunnable does the job fail."""
        best_code = state.get("best_code")
        best_report = state.get("best_report")
        if best_code is not None and best_report is not None:
            logger.warning(
                "publishing game %s best-effort after %s attempts; advisory failures: %s",
                state["game_id"],
                state.get("code_attempts"),
                [c.check_id for c in best_report.failures],
            )
            return {"code": best_code, "gate_report": best_report}
        report = state["gate_report"]
        logger.error(
            "no shippable attempt for game %s after %s attempts; blocking failures: %s",
            state["game_id"],
            state.get("code_attempts"),
            [c.check_id for c in report.blocking_failures],
        )
        return {
            "failure": PipelineFailure(
                stage=PipelineStage.VALIDATION,
                code=FailureCode.GATE_FAILED,
                message="quality gate failed after retries:\n" + report.feedback(),
            )
        }

    # ------------------------------------------------------------------ #
    # 5. Packaging — assemble the self-contained bundle from the template
    # ------------------------------------------------------------------ #

    async def package(self, state: GenerationState) -> dict:
        files = self._assembler.assemble(
            state["game_id"],
            state["blueprint"],
            state["code"],
            background_art=state.get("background_art"),
            sprites=state.get("sprites"),
        )
        return {"bundle_files": files}

    # ------------------------------------------------------------------ #
    # 6. Storage — write the bundle through the storage port
    # ------------------------------------------------------------------ #

    async def store(self, state: GenerationState) -> dict:
        prefix = state.get("target_prefix") or game_storage_prefix(state["game_id"])
        await store_bundle(self._storage, prefix, state["bundle_files"])
        return {"stored_prefix": prefix}
