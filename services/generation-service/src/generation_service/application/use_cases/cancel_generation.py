"""Cancels an in-flight generation at the creator's request.

The status check + FAILED mark run under the shared terminal lock, so a
finishing pipeline can never interleave its success between them; the
running task (if any) is cancelled afterwards — its teardown sees the
terminal row and leaves it alone, so the creator's cancel is never
overwritten by the generic 'interrupted' message.
"""

from __future__ import annotations

import asyncio

from generation_service.application.events import JobEventBus, JobEventEmitter
from generation_service.application.job_runner import BackgroundJobRunner
from generation_service.domain.entities import FailureCode, GenerationJob, JobStatus
from generation_service.domain.errors import ConflictError, NotFoundError
from generation_service.domain.ports import JobEventStore, JobRepository


class CancelGenerationUseCase:
    def __init__(
        self,
        jobs: JobRepository,
        runner: BackgroundJobRunner,
        event_store: JobEventStore,
        event_bus: JobEventBus,
        terminal_lock: asyncio.Lock | None = None,
    ) -> None:
        self._jobs = jobs
        self._runner = runner
        self._event_store = event_store
        self._event_bus = event_bus
        self._terminal_lock = terminal_lock or asyncio.Lock()

    async def execute(self, job_id: str) -> GenerationJob:
        async with self._terminal_lock:
            job = await self._jobs.get(job_id)
            if job is None:
                raise NotFoundError(f"generation {job_id!r} not found")
            if job.status in (JobStatus.SUCCEEDED, JobStatus.FAILED):
                raise ConflictError("this generation already finished")

            await self._jobs.mark_failed(
                job.id, FailureCode.CANCELLED, "cancelled by the creator"
            )
            emitter = JobEventEmitter(
                job.id,
                self._event_store,
                self._event_bus,
                start_seq=await self._event_store.last_seq(job.id),
            )
            await emitter.emit("failed", {
                "error_code": FailureCode.CANCELLED.value,
                "error_user_msg": "Generation stopped.",
            })
        # Outside the lock: task.cancel() only schedules cancellation; the
        # task's teardown re-checks the (now terminal) row under the lock.
        for name in (f"generation:{job.id}", f"tweak:{job.id}"):
            self._runner.cancel(name)

        refreshed = await self._jobs.get(job.id)
        assert refreshed is not None
        return refreshed
