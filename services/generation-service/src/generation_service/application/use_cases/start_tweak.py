"""Accepts a chat-edit instruction for an existing game and schedules the
tweak rebuild (revise blueprint → regenerate code → gate → overwrite in place)."""

from __future__ import annotations

from generation_service.application.job_runner import BackgroundJobRunner
from generation_service.application.use_cases.run_generation import RunGenerationUseCase
from generation_service.domain.constraints import (
    INSTRUCTION_MAX_CHARS,
    INSTRUCTION_MIN_CHARS,
)
from generation_service.domain.entities import GenerationJob, JobKind
from generation_service.domain.errors import (
    ConflictError,
    FeatureDisabledError,
    InvalidPromptError,
    NotFoundError,
)
from generation_service.domain.ports import GameRepository, JobRepository


class StartTweakUseCase:
    def __init__(
        self,
        games: GameRepository,
        jobs: JobRepository,
        runner: BackgroundJobRunner,
        run_generation: RunGenerationUseCase,
        enabled: bool,
    ) -> None:
        self._games = games
        self._jobs = jobs
        self._runner = runner
        self._run_generation = run_generation
        self._enabled = enabled

    async def execute(self, game_id: str, instruction: str) -> GenerationJob:
        if not self._enabled:
            raise FeatureDisabledError("the tweak feature is disabled (FEATURE_TWEAKS_API)")

        game = await self._games.get(game_id)
        if game is None:
            raise NotFoundError(f"game {game_id!r} not found")

        instruction = instruction.strip()
        if len(instruction) < INSTRUCTION_MIN_CHARS:
            raise InvalidPromptError("instruction is too short")
        if len(instruction) > INSTRUCTION_MAX_CHARS:
            raise InvalidPromptError(f"instruction exceeds {INSTRUCTION_MAX_CHARS} characters")

        # One rebuild at a time per game: concurrent tweaks would interleave
        # writes into the same live bundle and clobber each other's metadata.
        if await self._jobs.has_active_job_for_game(game.id):
            raise ConflictError(
                "this game is already being updated — wait for the current edit to finish"
            )

        job = GenerationJob.create(
            prompt=instruction,
            requested_locale=game.default_locale,
            kind=JobKind.TWEAK,
            game_id=game.id,
        )
        await self._jobs.add(job)
        self._runner.submit(self._run_generation.execute(job), name=f"tweak:{job.id}")
        return job
