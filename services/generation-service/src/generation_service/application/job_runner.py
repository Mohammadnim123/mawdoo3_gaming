"""In-process background job execution.

MVP-deliberate: generation jobs run as tracked asyncio tasks inside the
service. The seam for a real broker (Redis/queue) later is exactly this
class — the use cases only know `submit()`.

Concurrency is bounded: submissions beyond the cap wait their turn (the job
row stays QUEUED until the pipeline actually starts), so a burst of prompts
degrades to a queue instead of N simultaneous LLM pipelines.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Coroutine

logger = logging.getLogger(__name__)


class BackgroundJobRunner:
    def __init__(self, max_concurrent: int = 4) -> None:
        self._tasks: set[asyncio.Task] = set()
        self._semaphore = asyncio.Semaphore(max(1, max_concurrent))

    def submit(self, coro: Coroutine, name: str) -> None:
        task = asyncio.get_running_loop().create_task(self._run(coro), name=name)
        self._tasks.add(task)
        task.add_done_callback(self._on_done)

    async def _run(self, coro: Coroutine) -> None:
        try:
            async with self._semaphore:
                await coro
        finally:
            # If cancelled while queued, the job coroutine was never started;
            # close it so it doesn't warn.
            coro.close()

    def _on_done(self, task: asyncio.Task) -> None:
        self._tasks.discard(task)
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            # Job use cases persist their own failures; this is the last-resort net.
            logger.error("background job %s crashed", task.get_name(), exc_info=exc)

    async def shutdown(self) -> None:
        for task in self._tasks:
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
