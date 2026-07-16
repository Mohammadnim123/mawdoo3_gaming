"""In-process job-event bus + emitter.

The API and the background workers share one process (BackgroundJobRunner), so
live progress needs no Redis: a subscriber registers a queue, the running job
publishes events to it. Persistence (replay) is handled separately by a
``JobEventStore``; the emitter writes both.
"""

from __future__ import annotations

import asyncio

from generation_service.domain.events import JobEvent
from generation_service.domain.ports import JobEventStore


class JobEventBus:
    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = {}

    def subscribe(self, job_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._subs.setdefault(job_id, set()).add(queue)
        return queue

    def unsubscribe(self, job_id: str, queue: asyncio.Queue) -> None:
        subs = self._subs.get(job_id)
        if subs is None:
            return
        subs.discard(queue)
        if not subs:
            self._subs.pop(job_id, None)

    def publish(self, job_id: str, event: JobEvent) -> None:
        for queue in list(self._subs.get(job_id, ())):
            queue.put_nowait(event)


class JobEventEmitter:
    """Assigns monotonic seq numbers for one job, persisting + publishing each.

    One job runs in one task, so a plain in-memory counter is sufficient.
    """

    def __init__(self, job_id: str, store: JobEventStore, bus: JobEventBus) -> None:
        self._job_id = job_id
        self._store = store
        self._bus = bus
        self._seq = 0

    async def emit(self, event: str, data: dict | None = None) -> None:
        self._seq += 1
        ev = JobEvent(seq=self._seq, event=event, data=data or {})
        await self._store.append(self._job_id, ev)
        self._bus.publish(self._job_id, ev)
