"""Accepts a prompt, creates a job, and schedules the pipeline run."""

from __future__ import annotations

from generation_service.application.job_runner import BackgroundJobRunner
from generation_service.application.use_cases.run_generation import RunGenerationUseCase
from generation_service.domain.constraints import PROMPT_MAX_CHARS, PROMPT_MIN_CHARS
from generation_service.domain.entities import GenerationJob
from generation_service.domain.errors import InvalidPromptError
from generation_service.domain.ports import JobRepository


class StartGenerationUseCase:
    def __init__(
        self,
        jobs: JobRepository,
        runner: BackgroundJobRunner,
        run_generation: RunGenerationUseCase,
    ) -> None:
        self._jobs = jobs
        self._runner = runner
        self._run_generation = run_generation

    async def execute(
        self,
        prompt: str,
        requested_locale: str | None,
        skip_clarify: bool = False,
    ) -> GenerationJob:
        prompt = prompt.strip()
        if len(prompt) < PROMPT_MIN_CHARS:
            raise InvalidPromptError("prompt is too short to describe a game")
        if len(prompt) > PROMPT_MAX_CHARS:
            raise InvalidPromptError(f"prompt exceeds {PROMPT_MAX_CHARS} characters")

        job = GenerationJob.create(
            prompt=prompt, requested_locale=requested_locale, skip_clarify=skip_clarify
        )
        await self._jobs.add(job)
        self._runner.submit(self._run_generation.execute(job), name=f"generation:{job.id}")
        return job
