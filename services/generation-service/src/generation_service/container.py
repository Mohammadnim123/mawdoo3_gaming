"""Composition root.

All wiring lives here — construction order makes the dependency graph
explicit, and nothing else in the codebase instantiates infrastructure.
"""

from __future__ import annotations

import logging

from generation_service.application.job_runner import BackgroundJobRunner
from generation_service.application.use_cases import (
    GetGameUseCase,
    GetGenerationUseCase,
    ListGamesUseCase,
    RunGenerationUseCase,
    StartGenerationUseCase,
    StartTweakUseCase,
)
from generation_service.config.settings import Settings
from generation_service.domain.entities import FailureCode
from generation_service.infrastructure.ai.llm import StructuredLlm, create_client
from generation_service.infrastructure.ai.nodes import GenerationNodes
from generation_service.infrastructure.ai.pipeline import GenerationPipeline
from generation_service.infrastructure.packaging.assembler import (
    StarterTemplate,
    TemplateAssembler,
)
from generation_service.infrastructure.persistence import (
    Database,
    SqliteGameRepository,
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
        self.llm_log = SqliteLlmCallLog(self.database)

        # Jobs run in-process, so anything still queued/running in the DB was
        # lost with the previous process — fail it now instead of letting
        # clients poll a phantom 'running' job forever.
        abandoned = await self.jobs.fail_abandoned(
            FailureCode.INTERRUPTED,
            "the service restarted before this job finished — please submit again",
        )
        if abandoned:
            logger.warning("failed %d job(s) abandoned by a previous process", abandoned)

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

        nodes = GenerationNodes(
            understanding_llm=structured(s.ai.understanding_model),
            blueprint_llm=structured(s.ai.blueprint_model),
            code_llm=structured(s.ai.code_model),
            gate=self.gate,
            assembler=self.assembler,
            storage=self.storage,
            llm_log=self.llm_log,
        )
        self.pipeline = GenerationPipeline(
            nodes,
            max_code_retries=s.pipeline.generation_max_code_retries,
            deep_review_enabled=s.features.feature_llm_review,
        )

        # Application
        self.job_runner = BackgroundJobRunner(
            max_concurrent=s.pipeline.generation_max_concurrent
        )
        self.run_generation = RunGenerationUseCase(
            pipeline=self.pipeline,
            jobs=self.jobs,
            games=self.games,
            template_version=template.version,
            blueprint_model=s.ai.blueprint_model,
            code_model=s.ai.code_model,
            timeout_seconds=s.pipeline.generation_timeout_seconds,
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
        self.get_generation = GetGenerationUseCase(self.jobs)
        self.list_games = ListGamesUseCase(self.games)
        self.get_game = GetGameUseCase(self.games)

        logger.info(
            "container ready — template v%s, provider=%s, storage=%s",
            template.version,
            s.ai.ai_provider,
            s.storage.storage_backend,
        )

    async def shutdown(self) -> None:
        await self.job_runner.shutdown()
        await self.database.close()
