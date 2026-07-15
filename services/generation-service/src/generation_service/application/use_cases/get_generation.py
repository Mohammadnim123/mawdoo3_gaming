from __future__ import annotations

from generation_service.domain.entities import GenerationJob
from generation_service.domain.errors import NotFoundError
from generation_service.domain.ports import JobRepository


class GetGenerationUseCase:
    def __init__(self, jobs: JobRepository) -> None:
        self._jobs = jobs

    async def execute(self, job_id: str) -> GenerationJob:
        job = await self._jobs.get(job_id)
        if job is None:
            raise NotFoundError(f"generation {job_id!r} not found")
        return job
