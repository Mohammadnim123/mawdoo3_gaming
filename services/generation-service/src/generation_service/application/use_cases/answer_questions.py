"""Resumes a generation paused on clarifying questions.

The creator's answers (question id -> option id or free text) are persisted
on the job, then the pipeline re-enters in resume mode with the stored intake
analysis — the understand stage never runs twice. An empty answers dict is
'Surprise me': every question falls back to its default option.
"""

from __future__ import annotations

from generation_service.application.job_runner import BackgroundJobRunner
from generation_service.application.use_cases.run_generation import RunGenerationUseCase
from generation_service.domain.entities import GenerationJob, JobStatus
from generation_service.domain.errors import ConflictError, NotFoundError
from generation_service.domain.ports import JobRepository

_ANSWER_MAX_CHARS = 300


class AnswerQuestionsUseCase:
    def __init__(
        self,
        jobs: JobRepository,
        runner: BackgroundJobRunner,
        run_generation: RunGenerationUseCase,
    ) -> None:
        self._jobs = jobs
        self._runner = runner
        self._run_generation = run_generation

    async def execute(self, job_id: str, answers: dict[str, str]) -> GenerationJob:
        job = await self._jobs.get(job_id)
        if job is None:
            raise NotFoundError(f"generation {job_id!r} not found")
        if job.status != JobStatus.AWAITING_INPUT:
            raise ConflictError("this generation is not waiting for answers")

        known_ids = {question.id for question in job.questions}
        cleaned = {
            key: value.strip()[:_ANSWER_MAX_CHARS]
            for key, value in answers.items()
            if key in known_ids and isinstance(value, str) and value.strip()
        }
        # CAS: exactly one submitter wins the pause. A double-click, second
        # tab, or racing cancel loses here and never schedules a resume —
        # two pipelines for one job would corrupt the event log and publish
        # two games.
        if not await self._jobs.set_answers(job.id, cleaned):
            raise ConflictError("this generation is not waiting for answers")

        job = await self._jobs.get(job.id)
        assert job is not None
        self._runner.submit(
            self._run_generation.execute(job, resume=True), name=f"generation:{job.id}"
        )
        return job
