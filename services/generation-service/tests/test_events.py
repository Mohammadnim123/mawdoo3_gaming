"""Job-event log + in-process bus + emitter (the SSE substrate)."""

from __future__ import annotations

import asyncio

from generation_service.application.events import JobEventBus, JobEventEmitter
from generation_service.infrastructure.persistence import Database, PostgresJobEventStore


def test_event_log_replay_and_live_bus(pg_db_url):
    async def run() -> None:
        db = Database(pg_db_url)
        await db.connect()
        try:
            store = PostgresJobEventStore(db)
            bus = JobEventBus()
            queue = bus.subscribe("job1")
            emitter = JobEventEmitter("job1", store, bus)

            await emitter.emit("step", {"step": "planning", "label": "Designing"})
            await emitter.emit("done", {"game_id": "g1"})

            # Live delivery on the bus, in order, with monotonic seq.
            e1 = queue.get_nowait()
            e2 = queue.get_nowait()
            assert (e1.seq, e1.event) == (1, "step")
            assert (e2.seq, e2.event) == (2, "done")
            assert e2.data["game_id"] == "g1"

            # Persisted replay from Last-Event-ID.
            allev = await store.list_since("job1", 0)
            assert [e.event for e in allev] == ["step", "done"]
            assert [e.seq for e in await store.list_since("job1", 1)] == [2]
            assert await store.list_since("job1", 2) == []

            # Per-job isolation + unsubscribe.
            assert await store.list_since("other-job", 0) == []
            bus.unsubscribe("job1", queue)
            emitter2 = JobEventEmitter("job1", store, bus)  # noqa: F841
            await emitter.emit("failed", {"error_code": "x"})  # no subscribers → no error
        finally:
            await db.close()

    asyncio.run(run())
