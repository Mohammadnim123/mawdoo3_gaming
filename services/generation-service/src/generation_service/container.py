"""Composition root.

All wiring lives here — construction order makes the dependency graph
explicit, and nothing else in the codebase instantiates infrastructure.
"""

from __future__ import annotations

import logging

from generation_service.application.events import JobEventBus
from generation_service.application.job_runner import BackgroundJobRunner
from generation_service.application.use_cases import (
    AnswerQuestionsUseCase,
    CancelGenerationUseCase,
    GetGameUseCase,
    GetGenerationUseCase,
    GetVersionSourceUseCase,
    ListGamesUseCase,
    ListVersionsUseCase,
    RollbackUseCase,
    RunGenerationUseCase,
    StartGenerationUseCase,
    StartTweakUseCase,
)
from generation_service.config.settings import Settings
from generation_service.domain.entities import FailureCode
from generation_service.infrastructure.ai.llm import StructuredLlm, create_client
from generation_service.infrastructure.ai.nodes import GenerationNodes
from generation_service.infrastructure.ai.pipeline import GenerationPipeline
from generation_service.infrastructure.art import GeminiArtClient
from generation_service.infrastructure.packaging.assembler import (
    StarterTemplate,
    TemplateAssembler,
)
from generation_service.infrastructure.persistence import (
    Database,
    SqliteGameRepository,
    SqliteGameVersionRepository,
    SqliteJobEventStore,
    SqliteJobRepository,
    SqliteLlmCallLog,
)
from generation_service.infrastructure.storage import LocalFolderStorage
from generation_service.infrastructure.validation.gate import QualityGate

logger = logging.getLogger(__name__)


class Container:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def startup(self) -> None:
        s = self.settings

        # Persistence
        self.database = Database(s.database.sqlite_path)
        await self.database.connect()
        self.games = SqliteGameRepository(self.database)
        self.jobs = SqliteJobRepository(self.database)
        self.versions = SqliteGameVersionRepository(self.database)
        self.llm_log = SqliteLlmCallLog(self.database)
        self.job_events = SqliteJobEventStore(self.database)
        # In-process pub/sub for live SSE (API + workers share this process).
        self.job_event_bus = JobEventBus()

        # Jobs run in-process, so anything still queued/running in the DB was
        # lost with the previous process — fail it now instead of letting
        # clients poll a phantom 'running' job forever.
        abandoned = await self.jobs.fail_abandoned(
            FailureCode.INTERRUPTED,
            "the service restarted before this job finished — please submit again",
        )
        if abandoned:
            logger.warning("failed %d job(s) abandoned by a previous process", abandoned)
        expired = await self.jobs.expire_stale_awaiting(
            FailureCode.EXPIRED,
            "the clarifying questions went unanswered — please submit again",
            max_age_hours=s.pipeline.clarify_answer_ttl_hours,
        )
        if expired:
            logger.info("expired %d job(s) stuck awaiting answers", expired)

        # Storage (local mirrors the future bucket layout; s3 is the config swap)
        if s.storage.storage_backend != "local":
            raise NotImplementedError(
                "object-storage backend is a post-MVP config swap; set STORAGE_BACKEND=local"
            )
        self.storage = LocalFolderStorage(s.storage.storage_local_dir)

        # Template + packaging + gate (fail fast if the template is broken)
        template = StarterTemplate.load(s.pipeline.template_dir)
        self.assembler = TemplateAssembler(template)
        self.gate = QualityGate(
            node_syntax_check=s.pipeline.gate_node_syntax_check,
            max_game_kb=s.pipeline.gate_max_game_kb,
            smoke_boot=s.pipeline.gate_smoke_boot,
            smoke_boot_timeout_seconds=s.pipeline.gate_smoke_boot_timeout_seconds,
            syntax_check_timeout_seconds=s.pipeline.gate_syntax_check_timeout_seconds,
        )

        # AI pipeline — one Anthropic SDK client, one structured caller per
        # stage model (Agent 1 designs on the blueprint model, Agent 2
        # implements on the code model).
        client = create_client(s.ai)

        def structured(model: str) -> StructuredLlm:
            return StructuredLlm(
                client,
                model,
                temperature=s.ai.llm_temperature,
                max_output_tokens=s.ai.llm_max_output_tokens,
            )

        # Background painting — optional quality lever; silently absent
        # without a key so local setups keep working with zero config.
        art = None
        if s.features.feature_background_art and s.art.gemini_api_key:
            art = GeminiArtClient(
                s.art.gemini_api_key,
                model=s.art.gemini_image_model,
                base_url=s.art.gemini_base_url,
                timeout_seconds=s.art.art_timeout_seconds,
            )
        else:
            logger.info("background painting disabled (feature flag off or no GEMINI_API_KEY)")

        nodes = GenerationNodes(
            understanding_llm=structured(s.ai.understanding_model),
            blueprint_llm=structured(s.ai.blueprint_model),
            code_llm=structured(s.ai.code_model),
            gate=self.gate,
            assembler=self.assembler,
            storage=self.storage,
            llm_log=self.llm_log,
            art=art,
        )
        self.pipeline = GenerationPipeline(
            nodes,
            max_code_retries=s.pipeline.generation_max_code_retries,
            deep_review_enabled=s.features.feature_llm_review,
            clarify_enabled=s.features.feature_clarify,
        )

        # Application
        self.job_runner = BackgroundJobRunner(
            max_concurrent=s.pipeline.generation_max_concurrent
        )
        self.run_generation = RunGenerationUseCase(
            pipeline=self.pipeline,
            jobs=self.jobs,
            games=self.games,
            versions=self.versions,
            template_version=template.version,
            blueprint_model=s.ai.blueprint_model,
            code_model=s.ai.code_model,
            timeout_seconds=s.pipeline.generation_timeout_seconds,
            event_store=self.job_events,
            event_bus=self.job_event_bus,
        )
        self.start_generation = StartGenerationUseCase(
            jobs=self.jobs, runner=self.job_runner, run_generation=self.run_generation
        )
        self.start_tweak = StartTweakUseCase(
            games=self.games,
            jobs=self.jobs,
            runner=self.job_runner,
            run_generation=self.run_generation,
            enabled=s.features.feature_tweaks_api,
        )
        self.answer_questions = AnswerQuestionsUseCase(
            jobs=self.jobs, runner=self.job_runner, run_generation=self.run_generation
        )
        self.cancel_generation = CancelGenerationUseCase(
            jobs=self.jobs,
            runner=self.job_runner,
            event_store=self.job_events,
            event_bus=self.job_event_bus,
        )
        self.get_generation = GetGenerationUseCase(self.jobs)
        self.list_games = ListGamesUseCase(self.games)
        self.get_game = GetGameUseCase(self.games)
        self.list_versions = ListVersionsUseCase(self.games, self.versions)
        self.get_version_source = GetVersionSourceUseCase(
            self.games, self.versions, self.storage
        )
        self.rollback = RollbackUseCase(self.games, self.versions, self.jobs)

        logger.info(
            "container ready — template v%s, provider=%s, storage=%s",
            template.version,
            s.ai.ai_provider,
            s.storage.storage_backend,
        )

    async def shutdown(self) -> None:
        await self.job_runner.shutdown()
        await self.database.close()
